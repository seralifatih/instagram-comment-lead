import {
  HttpCrawler,
  type HttpCrawlingContext,
  type HttpCrawlerOptions,
} from 'crawlee';

export type CrawlerFactoryOptions = {
  proxyConfiguration: HttpCrawlerOptions<HttpCrawlingContext>['proxyConfiguration'];
  requestQueue: HttpCrawlerOptions<HttpCrawlingContext>['requestQueue'];
  preNavigationHooks?: HttpCrawlerOptions<HttpCrawlingContext>['preNavigationHooks'];
  requestHandler: HttpCrawlerOptions<HttpCrawlingContext>['requestHandler'];
  failedRequestHandler?: HttpCrawlerOptions<HttpCrawlingContext>['failedRequestHandler'];
  maxConcurrency?: number;
  maxRequestsPerMinute?: number;
  maxRequestRetries?: number;
  retryOnBlocked?: boolean;
  requestHandlerTimeoutSecs?: number;
};

export function createCrawler(options: CrawlerFactoryOptions): HttpCrawler<HttpCrawlingContext> {
  const {
    proxyConfiguration,
    requestQueue,
    preNavigationHooks,
    requestHandler,
    failedRequestHandler,
    maxConcurrency = 4,
    maxRequestsPerMinute = 20,
    maxRequestRetries = 5,
    retryOnBlocked = true,
    requestHandlerTimeoutSecs = 60,
  } = options;

  const hooks = [
    (crawlingContext, gotOptions) => {
      // Disable HTTP/2 for IG to avoid early-terminated responses.
      (gotOptions as { http2?: boolean }).http2 = false;
    },
    ...(preNavigationHooks ?? []),
  ];

  return new HttpCrawler<HttpCrawlingContext>({
    proxyConfiguration,
    requestQueue,
    maxConcurrency,
    maxRequestsPerMinute,
    maxRequestRetries,
    retryOnBlocked,
    requestHandlerTimeoutSecs,
    preNavigationHooks: hooks,
    requestHandler,
    failedRequestHandler,
  });
}
