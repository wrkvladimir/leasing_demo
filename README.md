# JAICP Chat MCP Server

MCP server for interacting with JAICP Chatbots.

## Configuration

Set the following environment variables (e.g., in a `.env` file):

- `JAICP_TOKEN`: Your Chat API channel token.
- `JAICP_HOST`: (Optional) JAICP host, defaults to `bot.jaicp.com`.

## Tools

### `send_message`

Sends a message to the bot and returns the response.

**Arguments:**
- `query` (string): The message text.
- `clientId` (string): Unique identifier for the user session.

## Installation

```bash
npm install
```

## Running Locally

```bash
npm start
```

## Running with Docker

1. Build the image:
   ```bash
   docker build -t jaicp-mcp-server .
   ```
2. Run the container (passing environment variables):
   ```bash
   docker run -p 3000:3000 --env-file .env jaicp-mcp-server
   ```

## Connection

The server uses **SSE (Server-Sent Events)** for MCP communication.
- SSE endpoint: `http://localhost:3000/sse`
- Message endpoint: `http://localhost:3000/message`
- Health check: `http://localhost:3000/health`
