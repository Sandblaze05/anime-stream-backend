import WebTorrent from "webtorrent"
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const client = new WebTorrent();
const activeTorrents = new Map(); // Track torrents with active requests

app.get("/add/:magnet", (req, res) => {
  try {
    const magnetURI = decodeURIComponent(req.params.magnet);

    // Extract infoHash
    const infoHashMatch = magnetURI.match(/xt=urn:btih:([^&]+)/);
    if (!infoHashMatch) {
      return res.status(400).json({ error: "Invalid magnet link" });
    }
    const infoHash = infoHashMatch[1].toLowerCase();

    console.log(`Adding new torrent: ${magnetURI}`);

    function createTorrent() {
      const torrent = client.add(magnetURI);

      activeTorrents.set(infoHash, torrent); // Store active torrent

      torrent.on("metadata", () => {
        console.log(`Metadata received for ${torrent.infoHash}`);

        const files = torrent.files?.map((file) => ({
          name: file.name,
          length: file.length,
        })) || [];

        res.json({ files });

        setTimeout(() => {
          if (client.get(infoHash)) {
            console.log(`Removing inactive torrent: ${infoHash}`);
            torrent.destroy();
            activeTorrents.delete(infoHash);
          }
        }, 5 * 60 * 1000);
      });

      torrent.on("error", (err) => {
        console.error(`Torrent error: ${err.message}`);

        // Destroy the broken torrent
        if (client.get(infoHash)) {
          console.log(`Destroying faulty torrent: ${infoHash}`);
          torrent.destroy();
          activeTorrents.delete(infoHash);
        }

        // Try re-adding the torrent
        console.log(`Recreating torrent: ${infoHash}`);
        createTorrent();
      });
    }

    createTorrent();
  } catch (error) {
    console.error("Error adding torrent:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get("/stream/:fileName", (req, res) => {
  let fileName = decodeURIComponent(req.params.fileName);
  let torrent = client.torrents[0]; // Get the first active torrent

  if (!torrent) {
    return res.status(404).json({ error: "No active torrents" });
  }

  let file = torrent.files.find((f) => f.name === fileName);
  if (!file) {
    return res.status(404).json({ error: "File not found in torrent" });
  }

  res.setHeader("Content-Type", "video/mp4");

  let stream = file.createReadStream();

  stream.pipe(res);

  stream.on("error", (err) => {
    console.log("Stream error:", err.message);

    // Prevent sending response after headers are sent
    if (!res.headersSent) {
      res.status(500).json({ error: "Error in streaming file" });
    }

    // Destroy the stream safely
    stream.destroy();
  });

  req.on("close", () => {
    console.log(`Client disconnected while streaming ${fileName}`);
    
    // Delay destruction to allow reconnection
    setTimeout(() => {
      if (!res.headersSent) { // Check if response is still open
        console.log(`Destroying torrent ${torrent.infoHash} due to inactivity`);
        torrent.destroy();
        activeTorrents.delete(torrent.infoHash);
      }
    }, 5000);
  });
});

app.get('/', (req, res) => {
  res.status(200).json({status: 'running'});
});



app.listen(3000, () => {console.log("listening at 3000")});
