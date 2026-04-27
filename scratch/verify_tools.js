import axios from 'axios';
import { EventSource } from 'eventsource';

const baseUrl = 'http://localhost:3000';

async function verify() {
  console.log('Connecting to SSE at localhost:3000...');
  const es = new EventSource(`${baseUrl}/sse`);
  let messageUrl = '';

  es.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // console.log('Received:', JSON.stringify(data, null, 2));

    if (data.id === 1) {
      console.log('Tools found:', data.result.tools.map(t => t.name).join(', '));
      
      console.log('Testing get_exchange_rates...');
      axios.post(messageUrl, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_exchange_rates',
          arguments: {}
        }
      });
    } else if (data.id === 2) {
      console.log('get_exchange_rates response received!');
      console.log(JSON.stringify(data.result, null, 2).substring(0, 300) + '...');
      es.close();
      process.exit(0);
    }
  };

  es.addEventListener('endpoint', async (event) => {
    messageUrl = `${baseUrl}${event.data}`;
    console.log('Got endpoint:', messageUrl);

    try {
      console.log('Listing tools...');
      await axios.post(messageUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      });
    } catch (error) {
      console.error('Error sending request:', error.message);
      es.close();
      process.exit(1);
    }
  });

  es.onerror = (err) => {
    console.error('SSE Error:', err);
    es.close();
    process.exit(1);
  };
}

verify();
