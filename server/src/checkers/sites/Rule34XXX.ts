import type { SourceCheckQueueItem, SourceData, ScoredSourceData } from '../../../../shared';
import { getDOM } from '../../modules';
import { SourceChecker } from '../SourceChecker';

export default class Rule34XXXSourceChecker extends SourceChecker {
  constructor() {
    super('Rule34XXX');

    this.supported = [
      /^https?:\/\/(?:www\.)?rule34\.xxx\/index\.php.*s=view.*/,
    ];
  }

  async _internalProcessPost(post: SourceCheckQueueItem, source: string): Promise<SourceData> {
    try {
      const res = await fetch(source);

      if (!res.ok) {
        return {
          unknown: true,
          error: true
        };
      }

      const html = await res.text();
      const dom = getDOM(html);
      const document = dom.window.document;

      const url = document.querySelector('#image')?.getAttribute('src');

      if (!url) {
        return {
          unknown: true,
          error: true
        };
      }

      if (url.includes('samples')) {
        const originalUrl = document.querySelector('.link-list a[href*=images]')?.getAttribute('href');

        const matchData: ScoredSourceData[] = [];

        if (!originalUrl) {
          return {
            unknown: true,
            error: true,
            md5Match: false,
            dimensionMatch: false,
            fileTypeMatch: false
          };
        }

        const urls = [
          {
            url: originalUrl,
            isPreview: false
          },
          {
            url,
            isPreview: true
          }
        ];

        for (const urlData of urls) {
          const data = await SourceChecker.processDirectLink(post, urlData.url, urlData.isPreview) as ScoredSourceData;

          if (urlData.isPreview) {
            data.originalUrl = urls[0].url;
          }

          if (!data || data.error || data.unknown || data.unsupported) {
            data.score = 0;
            matchData.push(data);
            continue;
          }

          data.score = (Number(data.md5Match!) * 5000) + (1000 / (data.phashDistance! + 1)) + (Number(data.dimensionMatch!) * 200) + Number(data.fileTypeMatch) + (data.isPreview ? 0 : 5);

          matchData.push(data);
        }

        if (matchData.length > 0) {
          matchData.sort((a, b) => b.score! - a.score!);

          return matchData[0];
        }
      } else {
        return await SourceChecker.processDirectLink(post, url);
      }
    } catch (e) {
      console.error(e);
    }

    return {
      unknown: true,
      error: true,
    };
  }

}