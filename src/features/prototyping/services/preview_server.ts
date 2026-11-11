import * as http from 'node:http';
import * as path from 'node:path';
import { IFileSystem } from '../../../shared/infrastructure/file_system.js';
import { Result, ok, fail } from '../../../shared/domain/result.js';

export interface PreviewOptions {
  /** First port to try (HEXACORE_PREVIEW_PORT, default 4173); the next free one is used when it is taken. */
  port: number;
  enabled: boolean;
  /** Keep the process alive while serving (the CLI `preview` command); the MCP server doesn't need it. */
  keepAlive?: boolean;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};
const PORT_ATTEMPTS = 10;

/**
 * Serves .hexagen/prototypes on 127.0.0.1 only, read-only, so the user (and the ui check) can
 * open a prototype in a real browser. Started on first use; the current version of each page
 * reloads itself when a new version is saved.
 */
export class PreviewServer {
  private server?: http.Server;
  private starting?: Promise<Result<number, Error>>;
  private port?: number;

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly root: () => string,
    private readonly options: PreviewOptions
  ) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  /** URL of a prototype (its current version unless `version` is given); undefined when previews are off or the server can't start. */
  async url(name?: string, version?: number): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    const port = await this.start();
    if (port.isFailure) return undefined;
    return `http://127.0.0.1:${port.value}/${name ? `${name}/${version ? `v${version}/` : ''}` : ''}`;
  }

  start(): Promise<Result<number, Error>> {
    if (!this.enabled) return Promise.resolve(fail(new Error('Previews are disabled (HEXACORE_PREVIEW=off).')));
    this.starting ??= this.listen(this.options.port, PORT_ATTEMPTS);
    return this.starting;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.starting = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private listen(port: number, attemptsLeft: number): Promise<Result<number, Error>> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch(() => {
          res.writeHead(500).end();
        });
      });
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 1) resolve(this.listen(port + 1, attemptsLeft - 1));
        else if (error.code === 'EADDRINUSE' && port !== 0) resolve(this.listen(0, 1));
        else resolve(fail(new Error(`The preview server could not start: ${error.message}`)));
      });
      server.listen(port, '127.0.0.1', () => {
        if (!this.options.keepAlive) server.unref();
        this.server = server;
        this.port = (server.address() as { port: number }).port;
        resolve(ok(this.port));
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Only this machine, and only by its loopback name: blocks DNS-rebinding pages from reading prototypes.
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return void res.writeHead(403).end('Forbidden');
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();

    let segments: string[];
    try {
      segments = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return void res.writeHead(400).end();
    }
    if (segments.some((s) => s.startsWith('.') || s.includes('\\') || s.includes('/'))) return void res.writeHead(404).end('Not found');
    if (segments.length === 0) return this.send(res, 'text/html; charset=utf-8', await this.index());
    if (segments[0] === '__rev' && segments[1]) return this.send(res, 'text/plain; charset=utf-8', String(await this.revision(segments[1])));

    const [name, ...rest] = segments;
    const archived = /^v\d+$/.test(rest[0] ?? '') ? rest.shift() : undefined;
    const base = archived ? path.join(this.root(), '.versions', name, archived) : path.join(this.root(), name);
    if (rest.length === 0 && !(req.url ?? '').split('?')[0].endsWith('/')) return void res.writeHead(301, { Location: `/${name}/${archived ? `${archived}/` : ''}` }).end();

    const file = path.join(base, ...(rest.length ? rest : ['index.html']));
    if (!file.startsWith(this.root() + path.sep) || !(await this.isFile(file))) return void res.writeHead(404).end('Not found');
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    let body = await this.fileSystem.readFile(file);
    if (!archived && type.startsWith('text/html')) body = withReload(body, name);
    this.send(res, type, body);
  }

  private send(res: http.ServerResponse, type: string, body: string): void {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(body);
  }

  private async isFile(file: string): Promise<boolean> {
    if (!(await this.fileSystem.exists(file))) return false;
    // exists() is also true for directories; a directory has files below it.
    return (await this.fileSystem.listDirectory(file)).length === 0;
  }

  /** The current version number: changes whenever a new version is saved, from any process. */
  private async revision(name: string): Promise<number> {
    try {
      return JSON.parse(await this.fileSystem.readFile(path.join(this.root(), '.meta', `${name}.json`))).current ?? 0;
    } catch {
      return 0;
    }
  }

  private async index(): Promise<string> {
    const files = await this.fileSystem.listDirectory(path.join(this.root(), '.meta'));
    const names = files.filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json')).sort();
    const items = names.map((n) => `<li><a href="/${n}/">${n}</a></li>`).join('') || '<li>No prototypes yet. Create one with create_prototype.</li>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HexaCore prototypes</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:40px auto;max-width:640px;padding:0 16px"><h1>Prototypes</h1><ul>${items}</ul></body></html>`;
  }
}

function withReload(html: string, name: string): string {
  const script = `<script>(()=>{let r=null;setInterval(async()=>{try{const t=await(await fetch('/__rev/${name}',{cache:'no-store'})).text();if(r!==null&&t!==r)location.reload();r=t}catch(e){}},1500)})()</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}</body>`) : html + script;
}
