import WebTorrent from "webtorrent";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const client = new WebTorrent();
const activeTorrents = new Map(); // Track torrents with active requests
const activeStreams = new Map();  // Track active streams
const torrentRetries = new Map(); // Track retry attempts per torrent

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds
const CLEANUP_DELAY = 2 * 60 * 1000; // 2 minutes

app.get("/add/:magnet", (req, res) => {
  try {
    const magnetURI = decodeURIComponent(req.params.magnet);
    const infoHashMatch = magnetURI.match(/xt=urn:btih:([^&]+)/);
    
    if (!infoHashMatch) {
      return res.status(400).json({ error: "Invalid magnet link" });
    }
    
    const infoHash = infoHashMatch[1].toLowerCase();

    // Check if torrent is already being processed
    if (activeTorrents.has(infoHash)) {
      const existingTorrent = activeTorrents.get(infoHash);
      if (existingTorrent.ready) {
        return res.json({
          files: existingTorrent.files?.map((file) => ({
            name: file.name,
            length: file.length,
          }))
        });
      }
    }

    console.log(`Adding new torrent: ${infoHash}`);

    function createTorrent() {
      // Check retry count
      const retryCount = torrentRetries.get(infoHash) || 0;
      if (retryCount >= MAX_RETRIES) {
        console.log(`Max retries reached for torrent: ${infoHash}`);
        torrentRetries.delete(infoHash);
        return res.status(500).json({ error: "Failed to add torrent after multiple attempts" });
      }

      // Increment retry count
      torrentRetries.set(infoHash, retryCount + 1);

      const torrent = client.add(magnetURI, {
        maxWebConns: 30, // Increase max web connections
        path: './downloads' // Specify download path
      });

      activeTorrents.set(infoHash, torrent);

      torrent.on("metadata", () => {
        console.log(`Metadata received for ${infoHash}`);
        torrent.ready = true;
        torrentRetries.delete(infoHash); // Reset retry count on success

        const files = torrent.files?.map((file) => ({
          name: file.name,
          length: file.length,
        })) || [];

        // Only send response if it hasn't been sent yet
        if (!res.headersSent) {
          res.json({ files });
        }

        scheduleTorrentCleanup(infoHash);
      });

      torrent.on("error", (err) => {
        console.error(`Torrent error for ${infoHash}:`, err.message);
        
        if (client.get(infoHash)) {
          console.log(`Destroying faulty torrent: ${infoHash}`);
          torrent.destroy({ destroyStore: true });
          activeTorrents.delete(infoHash);
        }

        // Only retry if under max attempts and client is still connected
        if (retryCount < MAX_RETRIES && !res.headersSent) {
          console.log(`Retrying torrent: ${infoHash} (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(createTorrent, RETRY_DELAY * (retryCount + 1)); // Exponential backoff
        } else if (!res.headersSent) {
          res.status(500).json({ error: "Failed to add torrent" });
        }
      });

      // Add warning event handler
      torrent.on("warning", (warn) => {
        console.warn(`Torrent warning for ${infoHash}:`, warn.message);
      });
    }

    createTorrent();
  } catch (error) {
    console.error("Error adding torrent:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.get("/stream/:infoHash/:fileName", (req, res) => {
  try {
    const { infoHash, fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    
    console.log('Streaming request:', {
      infoHash,
      fileName: decodedFileName,
      activeTorrents: Array.from(activeTorrents.keys()),
      clientTorrents: client.torrents.map(t => t.infoHash)
    });

    // First check if we have the torrent in our tracking Map
    let torrent = activeTorrents.get(infoHash);
    
    if (!torrent) {
      // If not in our Map, check the client directly
      torrent = client.get(infoHash);
    }

    if (!torrent) {
      console.error(`Torrent not found for infoHash: ${infoHash}`);
      return res.status(404).json({ 
        error: "Torrent not found",
        message: "The requested torrent is not active. Try adding it again."
      });
    }

    if (!torrent.files) {
      console.error(`No files available for torrent: ${infoHash}`);
      return res.status(404).json({ 
        error: "No files available",
        message: "The torrent has no files available yet. Please wait for the metadata."
      });
    }

    const file = torrent.files.find((f) => f.name === decodedFileName);
    
    if (!file) {
      console.error(`File not found: ${decodedFileName} in torrent: ${infoHash}`);
      console.log('Available files:', torrent.files.map(f => f.name));
      return res.status(404).json({ 
        error: "File not found",
        message: "The requested file was not found in the torrent."
      });
    }

    // Handle range requests
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      });

      const stream = file.createReadStream({ start, end });
      handleStream(stream, torrent, infoHash, decodedFileName, res, req);
    } else {
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': 'video/mp4',
      });

      const stream = file.createReadStream();
      handleStream(stream, torrent, infoHash, decodedFileName, res, req);
    }
  } catch (error) {
    console.error("Streaming error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Error initiating stream",
        message: error.message
      });
    }
  }
});

function handleStream(stream, torrent, infoHash, fileName, res, req) {
  // Track active streams
  incrementActiveStreams(infoHash);

  stream.on("error", (err) => {
    console.error(`Stream error for ${fileName}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming error occurred" });
    }
    stream.destroy();
    decrementActiveStreams(infoHash);
  });

  stream.on("end", () => {
    console.log(`Stream ended for ${fileName}`);
    stream.destroy();
    decrementActiveStreams(infoHash);
  });

  req.on("close", () => {
    console.log(`Client disconnected from ${fileName}`);
    stream.destroy();
    decrementActiveStreams(infoHash);
  });

  stream.pipe(res);
}

function incrementActiveStreams(infoHash) {
  activeStreams.set(infoHash, (activeStreams.get(infoHash) || 0) + 1);
}

function decrementActiveStreams(infoHash) {
  const count = activeStreams.get(infoHash) || 0;
  if (count > 0) {
    activeStreams.set(infoHash, count - 1);
    scheduleTorrentCleanup(infoHash);
  }
}

function scheduleTorrentCleanup(infoHash) {
  setTimeout(() => {
    const activeCount = activeStreams.get(infoHash) || 0;
    if (activeCount === 0) {
      const torrent = client.get(infoHash);
      if (torrent) {
        console.log(`Cleaning up inactive torrent: ${infoHash}`);
        torrent.destroy({ destroyStore: true });
        activeTorrents.delete(infoHash);
        activeStreams.delete(infoHash);
      }
    }
  }, CLEANUP_DELAY);
}

process.on('SIGINT', () => {
  console.log('Cleaning up torrents before exit...');
  client.destroy(() => {
    console.log('Torrents cleaned up. Exiting...');
    process.exit();
  });
});

app.listen(3000, () => {
  console.log("Torrent streaming server listening on port 3000");
});
