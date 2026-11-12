import apiWorker from './index'
import { PUBLIC_MEDIA_PREFIX, servePublicMedia, type PublicMediaBucket } from './media'
import { validatePublicCatalogQuery } from './publicQueryBudget'

type ApiEnv = Parameters<typeof apiWorker.fetch>[1]

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith(PUBLIC_MEDIA_PREFIX)) {
      // Immutable R2 keys must not accept cache-busting query suffixes.
      // Keep GET/HEAD/Range/ETag semantics in the existing media handler.
      if ((request.method === 'GET' || request.method === 'HEAD') &&
          validatePublicCatalogQuery(url) === false) {
        return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } })
      }
      return servePublicMedia(request, env.MEDIA as unknown as PublicMediaBucket)
    }
    return apiWorker.fetch(request, env)
  },
}
