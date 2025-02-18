# Torrent Streaming Server

A Node.js server that allows streaming of torrent files via HTTP, built with WebTorrent and Express. The server handles torrent downloads and provides video streaming capabilities with support for range requests.

## Features

- Torrent metadata fetching
- Video streaming with range request support
- Automatic torrent cleanup
- Error handling with retry mechanism
- Resource management for active torrents and streams
- Graceful shutdown handling

## Prerequisites

- Node.js (version 14 or higher)
- npm or yarn package manager

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

Required dependencies:
- webtorrent
- express
- cors

## Configuration

The server uses several configuration constants that can be modified in the code:

```javascript
const MAX_RETRIES = 3         // Maximum number of retry attempts for adding torrents
const RETRY_DELAY = 5000      // Delay between retry attempts (in milliseconds)
const CLEANUP_DELAY = 120000  // Delay before cleaning up inactive torrents (2 minutes)
```

## API Endpoints

### Add Torrent

```
GET /add/:magnet
```

Adds a new torrent to the server. The magnet URI should be URL encoded.

**Parameters:**
- `magnet`: URL-encoded magnet link

**Response:**
```json
{
  "files": [
    {
      "name": "filename.mp4",
      "length": 1234567
    }
  ]
}
```

### Stream File

```
GET /stream/:infoHash/:fileName
```

Streams a file from the specified torrent.

**Parameters:**
- `infoHash`: Torrent info hash
- `fileName`: URL-encoded name of the file to stream

Supports range requests for seeking in video players.

## Error Handling

The server implements several error handling mechanisms:
- Retry logic for failed torrent additions
- Stream error handling
- Client disconnect handling
- Resource cleanup for inactive torrents

## Resource Management

The server tracks:
- Active torrents
- Active streams
- Retry attempts

Resources are automatically cleaned up when:
- Streams end or encounter errors
- Clients disconnect
- Torrents become inactive

## Usage Example

1. Add a torrent:
```bash
curl "http://localhost:3000/add/magnet%3A%3Fxt%3Durn%3Abtih%3AINFOHASH..."
```

2. Stream a file:
```bash
curl "http://localhost:3000/stream/INFOHASH/video.mp4"
```

## Running the Server

Start the server:

```bash
node server.js
```

The server will listen on port 3000 by default.

## Safety Notes

- The server includes built-in cleanup mechanisms to prevent resource leaks
- Torrents are automatically destroyed when inactive
- The server handles graceful shutdown on SIGINT (Ctrl+C)

## Limitations

- Streams only video files as MP4 format
- Torrents are stored temporarily and cleaned up after inactivity
- Maximum web connections per torrent is set to 30
