import { createServer } from 'node:http';
import { createApp } from './http/app';

const app = createApp();

const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  request.on('end', () => {
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      send(400, { error: 'the request body is not JSON' });
      return;
    }
    app.handle(request.method ?? 'GET', request.url ?? '/', body).then(
      (result) => { send(result.status, result.body); },
      (error: unknown) => {
        console.error(error);
        send(500, { error: 'internal error' });
      },
    );
  });
});

// PORT unset or 0: the system picks a free port.
server.listen(Number(process.env.PORT ?? 0), () => {
  const address = server.address();
  console.info(`Listening on port ${typeof address === 'object' && address !== null ? address.port : String(address)}`);
});
