import axios from 'axios';
import { EventSource } from 'eventsource';

const baseUrl = 'https://256760445-just-ai-leasing-mcp.app.caila.io';

async function test() {
  console.log('Connecting to SSE...');
  const es = new EventSource(`${baseUrl}/sse`);

  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received from SSE:', JSON.stringify(data, null, 2));
    if (data.id === 1) {
      console.log('Got response for tool call!');
      es.close();
    }
  };

  es.addEventListener('endpoint', async (event) => {
    const messageUrl = `${baseUrl}${event.data}`;
    console.log('Got endpoint:', messageUrl);

    try {
      console.log('Sending tool call...');
      await axios.post(messageUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: {
            query: 'Привет',
            clientId: 'test_from_antigravity'
          }
        }
      });
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
      es.close();
    }
  });

  es.onerror = (err) => {
    console.error('SSE Error:', err);
    es.close();
  };
}

test();
