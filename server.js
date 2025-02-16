import express from "express";
import WebTorrent from "webtorrent";
import cors from "cors";
import path from "path";
import fs from "fs";

const app = express();
const client = new WebTorrent();

app.use(cors());

// Add a torrent
app.get("/add/:magnet", async (req, res) => {
  try {
    let magnet = decodeURIComponent(req.params.magnet);

    if (!magnet.startsWith("magnet:?")) {
      return res.status(400).json({ error: "Invalid magnet link" });
    }

    client.add(magnet, function (torrent) {
      console.log("File received");

      let files = torrent.files?.map(file => ({
        name: file.name,
        length: file.length,
      })) || [];

      console.log(files);

      if (!res.writableEnded) {
        res.status(200).json({ files });
      }
    });

    setTimeout(() => {
      if (torrent.done) {
        console.log(`Removing inactive torrent: ${torrent.infoHash}`);
        torrent.destroy();
      }
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error("Error adding torrent:", error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "Internal server error", files: [] });
    }
  }
});

let activeStreams = {}; // Cache for active streams

app.get("/stream/:fileName", (req, res) => {
  let fileName = decodeURIComponent(req.params.fileName);
  let torrent = client.torrents[0];

  if (!torrent) {
    return res.status(404).json({ error: "No active torrents" });
  }

  let file = torrent.files.find(f => f.name === fileName);
  if (!file) {
    return res.status(404).json({ error: "File not found in torrent" });
  }

  res.setHeader("Content-Type", "video/mp4");

  if (activeStreams[fileName]) {
    console.log(`Reusing stream for ${fileName}`);
    activeStreams[fileName].pipe(res);
    return;
  }

  let stream = file.createReadStream();
  activeStreams[fileName] = stream;

  stream.on("error", (err) => {
    console.error("Stream error:", err.message);
    delete activeStreams[fileName];
    if (!res.headersSent) {
      res.status(500).json({ error: "Error in streaming file" });
    }
    res.end();
  });

  req.on("close", () => {
    console.log(`Client disconnected, closing stream for ${fileName}`);
    stream.destroy();
    delete activeStreams[fileName];
  });

  stream.pipe(res);
});

// Get metadata
app.get("/metadata/:magnet", (req, res) => {
  const magnet = decodeURIComponent(req.params.magnet);

  // Find the torrent using its info hash (not magnet link)
  let torrent = client.torrents.find(t => t.magnetURI === magnet || t.infoHash === magnet);

  if (!torrent) {
    return res.status(404).json({ error: "Torrent not found or still loading" });
  }

  // Ensure metadata is available
  if (!torrent.files || torrent.files.length === 0) {
    torrent.once("metadata", () => {
      sendMetadata(res, torrent);
    });

    torrent.once("error", (err) => {
      console.error("Error fetching metadata:", err);
      if (!res.headersSent) res.status(500).json({ error: "Error fetching metadata" });
    });

    return;
  }

  sendMetadata(res, torrent);
});

// Helper function to send metadata response
function sendMetadata(res, torrent) {
  res.json({
    name: torrent.name || "",
    files: torrent.files.map(file => ({
      name: file.name,
      length: file.length,
    })),
  });
}

app.get('/', (req,res) => {
  res.send("Anime-Stream-Backend running");
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
