import parseSrcset from 'parse-srcset';
import { wait } from '../../modules';
import { SourceChecker } from '../SourceChecker';
import type { SourceCheckQueueItem, SourceData, ScoredSourceData } from '../../../../shared';

export default class MastodonSourceChecker extends SourceChecker {
  constructor() {
    super('Mastodon');

    this.supported = [
      /^https?:\/\/(?:www\.)?pawoo\.net\/@.*\/(\d+).*/,
      /^https?:\/\/(?:www\.)?pawb\.fun\/@.*\/(\d+).*/,
      /^https?:\/\/(?:www\.)?baraag\.net\/@.*\/(\d+).*/,
      /^https?:\/\/(?:www\.)?mastodon\.social\/@.*\/(\d+).*/,
    ];
  }

  async _internalProcessPost(post: SourceCheckQueueItem, source: string): Promise<SourceData> {
    while (!SourceChecker.puppetReady) await wait(500);

    let page;
    try {
      page = await SourceChecker.browser!.newPage();
      await page.goto(source);

      const contentWarning = await SourceChecker.waitForSelectorOrNull(page, '.content-warning > button', 1000);

      if (contentWarning) {
        await contentWarning.evaluate(b => b.click());
      }

      const main = await SourceChecker.waitForSelectorOrNull(page, '.media-gallery', 5000);

      if (!main) {
        return {
          unknown: true,
          error: true
        };
      }

      const sensitive = await SourceChecker.waitForSelectorOrNull(main, '.spoiler-button__overlay', 1000);
      if (sensitive) {
        await sensitive.evaluate(b => b.click());
      }

      let allImages = (await main.$$('.media-gallery__item-thumbnail > img'));

      for (let i = 0; i < allImages.length; i++) {
        const parentAnchorHref = await allImages[i].evaluate(e => e.parentElement.href);

        const srcset = await allImages[i].evaluate(e => e.getAttribute('srcset'));
        if (!srcset) {
          allImages[i] = [await allImages[i].evaluate(e => e.getAttribute('src'))];
          continue;
        }
        const parsed = parseSrcset(srcset);
        allImages[i] = parsed.map(p => p.url);

        if (parentAnchorHref) allImages[i].push(parentAnchorHref);
      }

      allImages = allImages.flat();

      const matchData: ScoredSourceData[] = [];

      for (const url of allImages) {
        const data = await SourceChecker.processDirectLink(post, url) as ScoredSourceData;

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
    } catch (e) {
      console.error(e);
    } finally {
      await page?.close();
    }

    return {
      unknown: true,
      error: true
    };
  }

}