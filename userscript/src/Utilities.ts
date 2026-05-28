import type { ServerResponse, CompleteResponse, IncompleteResponse, SourceData } from '../../shared';
import { anyLinksSupported, getData } from './Backend';
import { force, spinner, noMatches, reload, info, phashMatch, md5Match, dimensionAndFileTypeMatch, dimensionMatch, aspectRatioMatch, fileTypeMatch, unknown, bvas, kemonoIcon } from './icons';
import { getKemonoDataFromUrl } from './Kemono';

export function getCSRFToken(): string {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

export function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function isCompleteResponse(response: ServerResponse): response is CompleteResponse {
  const incompleteResponse = response as IncompleteResponse;
  const completeResponse = response as CompleteResponse;
  if (incompleteResponse.notPending || incompleteResponse.unsupported || incompleteResponse.queued || incompleteResponse.notIndexed || !completeResponse.sources) return false;

  return true;
}

export function waitForSelector<T extends Element>(selector, timeout = 5000): Promise<T | null> {
  return new Promise(async (resolve) => {
    let waited = 0;
    while (true) {
      const ele = document.querySelector<T>(selector);
      if (ele) return resolve(ele);
      await wait(100);
      waited += 100;
      if (waited >= timeout) return resolve(null);
    }
  });
}

export function getImageBlob(fileUrl): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try {
      const container = document.getElementById('image-container')!;
      const image = new Image();

      const width = Number(container.getAttribute('data-width'));
      const height = Number(container.getAttribute('data-height'));
      const ratio = width < height ? 256 / width : 256 / height;
      const calculatedWidth = Math.floor(width * ratio);
      const calculatedHeight = Math.floor(height * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = calculatedWidth;
      canvas.height = calculatedHeight;

      image.onload = () => {
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0, calculatedWidth, calculatedHeight);
        setTimeout(() => { canvas.toBlob(resolve, 'image/png'); });
      };

      image.crossOrigin = '';
      image.src = fileUrl;
    } catch (e) {
      reject(e);
    }
  });
}

export function approximateAspectRatio(val, lim) {
  let lower = [0, 1];
  let upper = [1, 0];

  while (true) {
    const mediant = [lower[0] + upper[0], lower[1] + upper[1]];

    if (val * mediant[1] > mediant[0]) {
      if (lim < mediant[1]) {
        return upper;
      }
      lower = mediant;
    } else if (val * mediant[1] == mediant[0]) {
      if (lim >= mediant[1]) {
        return mediant;
      }
      if (lower[1] < upper[1]) {
        return lower;
      }
      return upper;
    } else {
      if (lim < mediant[1]) {
        return lower;
      }
      upper = mediant;
    }
  }
}

export function roundTo(x, n) {
  const power = 10 ** n;
  return Math.floor(x * power) / power;
}

export async function getBlueskyDid(handle) {
  try {
    const data: { did: string } = await new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: 'GET',
        url: `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`,
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);

            resolve(data);
          } catch (e) {
            reject(e);
          }
        },
        onerror: function (e) {
          reject(e);
        }
      });
    });

    return data.did;
  } catch (e) {
    console.error(e);
  }

  return null;
}

export async function getReplacementUrl(id, sourceData, source, reason) {
  let regexData: RegExpExecArray | null = null;
  if ((regexData = /https:\/\/bsky\.app\/profile\/(.*)\/post/.exec(source)) != null) {
    if (!regexData[1].startsWith('did:plc:')) {
      const did = await getBlueskyDid(regexData[1]);

      if (did) source = source.replace(regexData[1], did);
    }
  }

  return `https://e621.net/post_replacements/new?post_id=${id}&url=${encodeURIComponent(sourceData.originalUrl ? sourceData.originalUrl : sourceData.url)}&reason=${encodeURIComponent('[JSV] ' + reason)}&source=${encodeURIComponent(source)}`;
}

export async function processData(data: ServerResponse, refreshable = true, containerSelector = '.source-links') {
  console.log(data);
  const _isCompleteResponse = isCompleteResponse(data);
  if (!_isCompleteResponse && data.unsupported) return false;

  const id = parseInt(document.querySelector('#image-container[data-id]')?.getAttribute('data-id') ?? '-1');

  if (id == -1) return false;

  const container = document.querySelector(containerSelector);

  if (!container) return;

  if (container.firstChild?.nodeName == '#text') {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.innerText = container.firstChild.textContent!;
    container.firstChild.remove();
    container.insertBefore(span, container.firstElementChild);
  }

  if (!_isCompleteResponse && data.notPending && refreshable) {
    const linkHrefs = Array.from(container.querySelectorAll('a')).map(a => a.href);

    let supported = _isCompleteResponse || (!_isCompleteResponse && !data.unsupported);

    if (!supported && linkHrefs.length > 0) {
      if (await anyLinksSupported(linkHrefs)) supported = true;
    }

    if (supported) {
      const forceClone = force.cloneNode(true) as HTMLElement;
      forceClone.addEventListener('click', async () => {
        for (const ele of document.querySelectorAll('.jsv-icon')) {
          ele.remove();
        }
        forceClone.remove();

        const spinny = spinner.cloneNode(true) as HTMLElement;
        container.firstElementChild?.appendChild(spinny);
        const data = await getData(id, true, true);
        spinny.remove();
        processData(data);
      });
      container.firstElementChild?.appendChild(forceClone);
    }

    return supported;
  }

  if (!_isCompleteResponse && (data.queued || data.notIndexed) && refreshable) {
    container.firstElementChild?.appendChild(spinner.cloneNode(true));

    getData(id, true, true).then((data) => {
      for (const ele of document.querySelectorAll('.jsv-icon')) {
        ele.remove();
      }

      processData(data, false);
    });

    return true;
  } else if (!_isCompleteResponse && data.unsupported && refreshable) {
    const linkHrefs = Array.from(container.querySelectorAll('a')).map(a => a.href);

    if (linkHrefs.length > 0) {
      if (await anyLinksSupported(linkHrefs)) {
        const forceClone = force.cloneNode(true) as HTMLElement;
        forceClone.addEventListener('click', async () => {
          for (const ele of document.querySelectorAll('.jsv-icon')) {
            ele.remove();
          }
          forceClone.remove();

          const spinny = spinner.cloneNode(true) as HTMLElement;
          container.firstElementChild?.appendChild(spinny);
          const data = await getData(id, true, true);
          spinny.remove();
          processData(data);
        });
        container.firstElementChild?.appendChild(forceClone);
      }
    }

    const noMatchesClone = noMatches.cloneNode(true) as HTMLElement;
    noMatchesClone.title = 'Unsupported';
    container.firstElementChild?.appendChild(noMatchesClone);
    return true;
  }

  if (refreshable) {
    const reloadClone = reload.cloneNode(true) as HTMLElement;
    reloadClone.addEventListener('click', async () => {
      for (const ele of document.querySelectorAll('.jsv-icon')) {
        ele.remove();
      }
      reloadClone.remove();

      const spinny = spinner.cloneNode(true) as HTMLElement;
      container.firstElementChild?.appendChild(spinny);
      try {
        const data = await getData(id, true, true);
        spinny.remove();
        processData(data);
      } catch (e) {
        spinny.remove();
        console.error(e);
        Danbooru.error('Error reloading post. Check console.');
      }
    });
    container.firstElementChild?.appendChild(reloadClone);
  }

  const allSourceLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>('.source-link > a[href]'));

  const width = parseInt(document.querySelector<HTMLSpanElement>("span[itemprop='width']")?.innerText ?? '-1');
  const height = parseInt(document.querySelector<HTMLSpanElement>("span[itemprop='height']")?.innerText ?? '-1');
  const fileType = document.querySelector<HTMLElement>('#image-container[data-file-ext]')?.getAttribute('data-file-ext') ?? 'unk';

  const approxAspectRatio = approximateAspectRatio(width / height, 50);

  let anyMatches = false;

  if (_isCompleteResponse) {
    for (const [source, sourceData] of Object.entries(data.sources)) {
      const matchingSourceEntry = allSourceLinks.find(e => decodeURI(e.href) == source || e.href == source);

      if (matchingSourceEntry) {
        anyMatches = true;

        const embeddedInfo = info.cloneNode(true) as HTMLElement;

        let matchingAspectRatio = false;

        if (sourceData.dimensions) {
          const sourceApproxAspectRatio = approximateAspectRatio(width / height, 50);
          matchingAspectRatio = approxAspectRatio[0] == sourceApproxAspectRatio[0] && approxAspectRatio[1] == sourceApproxAspectRatio[1];

          embeddedInfo.title = `${sourceData.dimensions.width}x${sourceData.dimensions.height} (${roundTo(sourceData.dimensions.width / width, 2)}:${roundTo(sourceData.dimensions.height / height, 2)}) ${sourceData.fileType!.toUpperCase()}`;
          matchingSourceEntry.prepend(embeddedInfo);
        } else {
          embeddedInfo.title = 'UNK';
          matchingSourceEntry.prepend(embeddedInfo);
        }


        if (!sourceData.md5Match && sourceData.phashDistance !== undefined && sourceData.phashDistance != -1) {
          const phashClone = phashMatch.cloneNode(true) as HTMLElement;

          if (sourceData.phashDistance == 0) {
            embeddedInfo.after(phashClone);
          } else if (sourceData.phashDistance < 7) {
            phashClone.style.color = 'yellow';
            // phashClone.style.outlineColor = colors["yellow"][colorIndex]
            phashClone.title = 'Perceptually similar';
            embeddedInfo.after(phashClone);
          } else {
            phashClone.style.color = 'red';
            // phashClone.style.outlineColor = colors["red"][colorIndex]
            phashClone.title = 'Perceptually dissimilar';
            embeddedInfo.after(phashClone);
          }

          const pd = 100 - (sourceData.phashDistance / 64 * 100);
          phashClone.title += ` Similarity: ${Math.floor(pd)}%`;
        }

        if (sourceData.md5Match) {
          embeddedInfo.after(md5Match.cloneNode(true));
        } else if (sourceData.dimensionMatch && sourceData.fileTypeMatch) {
          embeddedInfo.after(dimensionAndFileTypeMatch.cloneNode(true));
        } else if (sourceData.dimensionMatch) {
          embeddedInfo.after(dimensionMatch.cloneNode(true));
        } else if (matchingAspectRatio) {
          if (sourceData.fileTypeMatch) {
            const clone = aspectRatioMatch.cloneNode(true) as HTMLElement;
            clone.title += ' file type match';
            clone.style.color = 'lime';
            embeddedInfo.after(clone);
          } else {
            const clone = aspectRatioMatch.cloneNode(true) as HTMLElement;
            clone.title += ' different file type';
            clone.style.color = 'yellow';
            embeddedInfo.after(clone);
          }
        } else if (sourceData.fileTypeMatch) {
          embeddedInfo.after(fileTypeMatch.cloneNode(true));
        } else if (sourceData.unknown) {
          embeddedInfo.after(unknown.cloneNode(true));
        } else {
          embeddedInfo.after(noMatches.cloneNode(true));
        }

        if (sourceData.isPreview) {
          const clone = bvas.cloneNode(true) as HTMLElement;
          clone.title = 'Matched version is preview image. Original version available.';
          clone.style.color = 'red';

          const a = document.createElement('a');
          a.classList.add('jsv-replacement-anchor');
          a.target = '_blank';
          a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
          a.appendChild(clone);

          if (sourceData.originalUrl) {
            a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
          }

          matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
        }

        if (sourceData.dimensions && sourceData.fileType) {
          if (sourceData.dimensions.width > width && sourceData.dimensions.height > height) {
            if (fileType == 'jpg' && sourceData.fileType == 'png') {
              const clone = bvas.cloneNode(true) as HTMLElement;
              clone.title = `Bigger dimensions, PNG ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

              const a = document.createElement('a');
              a.classList.add('jsv-replacement-anchor');
              a.target = '_blank';
              a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
              a.appendChild(clone);

              if (sourceData.originalUrl)
                a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
              else
                a.href = await getReplacementUrl(id, sourceData, source, 'Bigger dimensions, PNG');

              matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
            } else if (fileType == 'png' && sourceData.fileType == 'jpg') {
              if (sourceData.dimensions.width >= width * 3 && sourceData.dimensions.height >= height * 3) {
                const clone = bvas.cloneNode(true) as HTMLElement;
                clone.title = `3x size, JPG ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

                const a = document.createElement('a');
                a.classList.add('jsv-replacement-anchor');
                a.target = '_blank';
                a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
                a.appendChild(clone);

                if (sourceData.originalUrl)
                  a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
                else
                  a.href = await getReplacementUrl(id, sourceData, source, '3x size, JPG');

                matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
              } else if (sourceData.dimensions.width >= width * 2 && sourceData.dimensions.height >= height * 2) {
                const clone = bvas.cloneNode(true) as HTMLElement;
                clone.style.color = 'yellow';
                clone.title = `2x size, JPG ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

                const a = document.createElement('a');
                a.classList.add('jsv-replacement-anchor');
                a.target = '_blank';
                a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
                a.appendChild(clone);

                if (sourceData.originalUrl)
                  a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
                else
                  a.href = await getReplacementUrl(id, sourceData, source, '2x size, JPG');

                matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
              }
            } else if (fileType == sourceData.fileType) {
              const clone = bvas.cloneNode(true) as HTMLElement;
              clone.title = `Bigger (${sourceData.fileType.toUpperCase()}) ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

              const a = document.createElement('a');
              a.classList.add('jsv-replacement-anchor');
              a.target = '_blank';
              a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
              a.appendChild(clone);

              if (sourceData.originalUrl)
                a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
              else
                a.href = await getReplacementUrl(id, sourceData, source, 'Higher resolution');

              matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
            }
          } else if (fileType == 'jpg' && sourceData.fileType == 'png') {
            if (width <= sourceData.dimensions.width * 1.5 && height <= sourceData.dimensions.height * 1.5) {
              const clone = bvas.cloneNode(true) as HTMLElement;
              clone.title = `PNG Version ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

              const a = document.createElement('a');
              a.classList.add('jsv-replacement-anchor');
              a.target = '_blank';
              a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
              a.appendChild(clone);

              if (sourceData.originalUrl)
                a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
              else
                a.href = await getReplacementUrl(id, sourceData, source, 'PNG version');

              matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
            }
          } else if (fileType == sourceData.fileType) {
            if (sourceData.dimensions.width > width || sourceData.dimensions.height > height) {
              const clone = bvas.cloneNode(true) as HTMLElement;
              clone.title = `Bigger (${sourceData.fileType.toUpperCase()}) ${sourceData.dimensions.width}x${sourceData.dimensions.height}`;

              const a = document.createElement('a');
              a.classList.add('jsv-replacement-anchor');
              a.target = '_blank';
              a.setAttribute('data-replacement-url', sourceData.originalUrl ? sourceData.originalUrl : sourceData.url!);
              a.appendChild(clone);

              if (sourceData.originalUrl)
                a.href = await getReplacementUrl(id, sourceData, source, 'Original version');
              else
                a.href = await getReplacementUrl(id, sourceData, source, 'Higher resolution');

              matchingSourceEntry.insertBefore(a, matchingSourceEntry.children[2]);
            }
          }
        }
      }
    }
  }

  return anyMatches;
}

export function processDataOnPostView(data: ServerResponse) {
  const _isCompleteResponse = isCompleteResponse(data);

  let post = document.getElementById(`entry_${data.id}`);
  const isRe6 = !!post;

  if (!isRe6) post = document.querySelector(`article[data-id='${data.id}']`);

  if (!post) return;

  const postInfo = isRe6 ? post.querySelector('post-info') : post.querySelector('.thm-desc-a');

  if (!postInfo) return;

  for (const element of postInfo.querySelectorAll<HTMLElement>('.jsv-icon')) {
    element.remove();
  }

  if (!_isCompleteResponse && data.queued) {
    postInfo.appendChild(spinner.cloneNode(true));
    return;
  } else if (!_isCompleteResponse && data.unsupported) {
    const noMatchesClone = noMatches.cloneNode(true) as HTMLElement;
    noMatchesClone.title = 'Unsupported';
    postInfo.appendChild(noMatchesClone);
    return;
  }

  let flags = 0;
  let previewMatched = false;

  if (!_isCompleteResponse) return;

  let closestPerceptually: SourceData | null = null;

  for (const [source, sourceData] of Object.entries(data.sources)) {
    if (sourceData.md5Match) {
      flags |= 1;
    } else if (sourceData.dimensionMatch && sourceData.fileTypeMatch) {
      flags |= 2;
    } else if (sourceData.dimensionMatch) {
      flags |= 4;
    } else if (sourceData.fileTypeMatch) {
      flags |= 8;
    } else if (sourceData.unknown) {
      flags |= 16;
    } else {
      flags |= 32;
    }

    if (sourceData.isPreview) {
      previewMatched = true;
    }

    if (closestPerceptually == null || (sourceData.phashDistance! >= 0 && sourceData.phashDistance! < closestPerceptually.phashDistance!)) {
      closestPerceptually = sourceData;
    }
  }

  if ((flags & 1) == 1) {
    postInfo.appendChild(md5Match.cloneNode(true));
  } else if ((flags & 2) == 2) {
    postInfo.appendChild(dimensionAndFileTypeMatch.cloneNode(true));
  } else if ((flags & 4) == 4) {
    postInfo.appendChild(dimensionMatch.cloneNode(true));
  } else if ((flags & 8) == 8) {
    postInfo.appendChild(fileTypeMatch.cloneNode(true));
  } else if ((flags & 16) == 16) {
    postInfo.appendChild(unknown.cloneNode(true));
  } else if ((flags & 32) == 32) {
    postInfo.appendChild(noMatches.cloneNode(true));
  }

  if (!closestPerceptually!.md5Match && closestPerceptually!.phashDistance !== undefined && closestPerceptually!.phashDistance != -1) {
    const phashClone = phashMatch.cloneNode(true) as HTMLElement;

    if (closestPerceptually!.phashDistance == 0) {
      postInfo.appendChild(phashClone);
    } else if (closestPerceptually!.phashDistance < 7) {
      phashClone.style.color = 'yellow';
      // phashClone.style.outlineColor = colors["yellow"][colorIndex]
      phashClone.title = 'Perceptually similar';
      postInfo.appendChild(phashClone);
    } else {
      phashClone.style.color = 'red';
      // phashClone.style.outlineColor = colors["red"][colorIndex]
      phashClone.title = 'Perceptually dissimilar';
      postInfo.appendChild(phashClone);
    }

    const pd = 100 - (closestPerceptually!.phashDistance / 64 * 100);
    phashClone.title += ` Similarity: ${Math.floor(pd)}%`;
  }

  if (previewMatched) {
    const clone = bvas.cloneNode(true) as HTMLElement;
    clone.title = 'Matched version is preview image. Original version available.';
    clone.style.color = 'red';
    postInfo.appendChild(clone);
  }
}

export async function addKemonoData(url: string | undefined) {
  if (!url) return;

  const kemonoData = await getKemonoDataFromUrl(url);

  if (kemonoData?.posts) {
    const first = kemonoData.posts[0];
    const container = document.querySelector('.source-links');

    if (!first || !container) return;

    if (container.firstChild?.nodeName == '#text') {
      const span = document.createElement('span');
      span.style.display = 'inline-flex';
      span.innerText = container.firstChild.textContent!;
      container.firstChild.remove();
      container.insertBefore(span, container.firstElementChild);
    }

    const kemonoIconClone = kemonoIcon.cloneNode() as HTMLElement;
    kemonoIconClone.style.cursor = 'pointer';
    kemonoIconClone.addEventListener('click', () => {
      window.open(`https://kemono.cr/${first.service}/user/${first.user}/post/${first.id}`);
    });

    container.firstElementChild?.appendChild(kemonoIcon);
    return;
  }
}
