/** A request as a route sees it: no HTTP library's types, so generated routers fit any server. */
export interface IRequest {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface IResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface IRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** A path whose `:name` segments become `params`. */
  readonly path: string;
  handle(request: IRequest): Promise<IResponse>;
}
