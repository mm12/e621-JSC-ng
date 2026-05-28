import PixivApi from 'pixiv-api-client';
import { Database, wait } from '../../modules';
import { SourceChecker } from '../SourceChecker';
import { config } from '../../config';
import type { SourceCheckQueueItem, SourceData, ScoredSourceData } from '../../../../shared';

type PixivTokens = {
  token: string
}

export default class PixivSourceChecker extends SourceChecker {
  private ready = false;
  private disabled: boolean = false;
  private pixiv: PixivApi = new PixivApi();

  constructor() {
    super('Pixiv');

    this.supported = [
      /^https?:\/\/.*pixiv\.net\/.*artworks\/(\d+).*/,
    ];

    this.setup();
  }

  async setup() {
    this.ready = false;

    try {
      console.log('[PixivSourceChecker] Refreshing access token');
      const pixivData = await Database.getTokens<PixivTokens>('pixiv');

      const data = await this.pixiv.refreshAccessToken(pixivData?.token ?? config.PIXIV_REFRESH_TOKEN);

      await Database.setTokens<PixivTokens>('pixiv', { token: data.refresh_token });

      this.ready = true;
      console.log('[PixivSourceChecker] Refreshed access token');
    } catch (e) {
      console.error('[PixivSourceChecker] Failed to refresh access token. Disabling');
      console.error(e);
      this.disabled = true;
    }
  }

  async _internalProcessPost(post: SourceCheckQueueItem, source: string, retried: boolean = false): Promise<SourceData> {
    if (this.disabled) {
      console.log('[PixivSourceChecker] Attempted to check pixiv post, but pixiv is disabled.');
      return {
        unknown: true,
        error: true
      };
    }

    while (!this.ready) await wait(500);

    try {
      const id = (/^https?:\/\/.*pixiv\.net\/.*artworks\/(\d+).*/).exec(source)![1];

      if (!id) {
        return {
          unknown: true,
          error: true
        };
      }

      const res = await this.pixiv.illustDetail(id);

      if (!res.illust) {
        if (!retried) {
          console.error('[PixivSourceChecker] Refreshing tokens and trying again');
          await this.setup();
          return await this._internalProcessPost(post, source, true);
        }

        console.error(`[PixivSourceChecker] res.illust is undefined (${post._id}):`);
        console.error(res);
        return {
          unknown: true,
          error: true
        };
      }

      const matchData: ScoredSourceData[] = [];

      for (const page of res.illust.meta_pages) {
        for (const [key, src] of Object.entries(page.image_urls)) {
          const data = await SourceChecker.processDirectLink(post, src as string, key != 'original', { Referer: 'https://www.pixiv.net/' }) as ScoredSourceData;

          if (!data || data.error || data.unknown || data.unsupported) {
            data.score = 0;
            matchData.push(data);
            continue;
          }

          data.score = (Number(data.md5Match!) * 5000) + (1000 / (data.phashDistance! + 1)) + (Number(data.dimensionMatch!) * 200) + Number(data.fileTypeMatch) + (data.isPreview ? 0 : 5);

          matchData.push(data);
        }
      }

      const single = res.illust.meta_single_page;

      if (single && single.original_image_url) {
        const src = single.original_image_url;
        const data = await SourceChecker.processDirectLink(post, src as string, false, { Referer: 'https://www.pixiv.net/' }) as ScoredSourceData;

        if (!data || data.error || data.unknown || data.unsupported) {
          data.score = 0;
        } else {
          data.score = (Number(data.md5Match!) * 5000) + (1000 / (data.phashDistance! + 1)) + (Number(data.dimensionMatch!) * 200) + Number(data.fileTypeMatch) + (data.isPreview ? 0 : 5);
        }

        matchData.push(data);
      }

      if (matchData.length > 0) {
        matchData.sort((a, b) => b.score! - a.score!);

        return matchData[0];
      }
    } catch (e) {
      if (!retried) {
        console.error('[PixivSourceChecker] Refreshing tokens and trying again');
        await this.setup();
        return await this._internalProcessPost(post, source, true);
      }

      console.error(e);
    }

    return {
      unknown: true,
      error: true,
    };
  }

}