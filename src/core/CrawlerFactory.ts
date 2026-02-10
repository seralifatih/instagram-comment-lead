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
  http2?: HttpCrawlerOptions<HttpCrawlingContext>['http2'];
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
    http2 = false,
    maxConcurrency = 4,
    maxRequestsPerMinute = 20,
    maxRequestRetries = 5,
    retryOnBlocked = true,
    requestHandlerTimeoutSecs = 60,
  } = options;

  return new HttpCrawler<HttpCrawlingContext>({
    proxyConfiguration,
    requestQueue,
    maxConcurrency,
    maxRequestsPerMinute,
    maxRequestRetries,
    retryOnBlocked,
    requestHandlerTimeoutSecs,
    http2,
    preNavigationHooks,
    requestHandler,
    failedRequestHandler,
  });
}
