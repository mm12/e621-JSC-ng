import type { SourceCheckQueueItem, SourceData } from '../../../../shared';
import { getDOM } from '../../modules';
import { SourceChecker } from '../SourceChecker';
export default class AryionSourceChecker extends SourceChecker {
  constructor() {
    super('Aryion');

    this.supported = [
      /^https?:\/\/(?:www\.)?aryion\.com\/g4\/view\/(\d+).*/
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

      const url = document.getElementById('item-itself')?.getAttribute('data-full-src') ?? document.getElementById('item-itself')?.querySelector('video > source')?.getAttribute('src');

      if (!url) {
        console.error(`Error with (no url): ${source} (${post._id})`);
        return {
          unknown: true,
          error: true
        };
      }

      return await SourceChecker.processDirectLink(post, url.startsWith('//') ? `https:${url}` : url);
    } catch (e) {
      console.error(e);
    }

    return {
      unknown: true,
      error: true,
    };
  }
}