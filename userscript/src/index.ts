import { getData, getDataBulk } from './Backend';
import { checkFluffle, hasCachedFluffleData } from './Fluffle';
import { addKemonoData, processData, processDataOnPostView, wait, waitForSelector } from './Utilities';

function addCSS() {
  document.head.append(Object.assign(document.createElement('style'), {
    type: 'text/css',
    textContent: `
.jsv-icon {
  width: 1.25em;
}

.jsv-replacement-anchor {
  display: inline-flex;
}

.loading:after {
  overflow: hidden;
  display: inline-block;
  vertical-align: bottom;
  -webkit-animation: ellipsis steps(4, end) 900ms infinite;
  animation: ellipsis steps(4, end) 900ms infinite;
  content: "\\2026";
  width: 0px;
}

@keyframes ellipsis {
  to {
    width: 16px;
  }
}

@-webkit-keyframes ellipsis {
  to {
    width: 16px;
  }
}

.spin {
  animation-name: spin;
  animation-direction: normal;
  animation-duration: 2s;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none !important;
    transition: none !important;
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.post-sidebar-info .source-links {
  display: inline-flex;
  flex-direction: column;
}

.source-link > a {
  display: inline-flex;
}
`
  }));
}

let timeOfMostRecentAddition = -1;
let additions: HTMLElement[] = [];

let interval;

function checkForNewPosts(mutationList: MutationRecord[], observer: MutationObserver) {
  for (const mutation of mutationList) {
    if (mutation.type === 'childList') {
      for (const addedNode of mutation.addedNodes) {
        const addedElement = addedNode as HTMLElement;
        if (addedElement.tagName == 'POST-INFO' || addedElement.classList?.contains('thm-desc')) {
          timeOfMostRecentAddition = Date.now();
          additions.push(mutation.target as HTMLElement);
          if (!interval && additions.length > 0) {
            interval = setInterval(async () => {
              if (Date.now() - timeOfMostRecentAddition > 500) {
                clearInterval(interval);
                interval = null;

                const ids = additions.map((p) => {
                  if (p.tagName == 'POST') return p.id.slice(6);
                  else return p.getAttribute('data-id') ?? '-1';
                });

                additions = [];

                const datas = await getDataBulk(ids.filter(id => id != '-1'));

                for (const data of datas) {
                  processDataOnPostView(data);
                }
              }
            }, 300);
          }
        }
      }
    }
  }
}

async function main() {
  addCSS();

  if (window.location.href.startsWith('https://e621.net/post_replacements/')) {
    const params = new URLSearchParams(window.location.search);

    const urlField = await waitForSelector<HTMLInputElement>("#replacement-uploader > * input[type='text']");
    const noSourceBox = await waitForSelector<HTMLInputElement>('#no_source');
    const sourceInput = await waitForSelector<HTMLInputElement>('.upload-source-row > input');
    const reasonField = await waitForSelector<HTMLInputElement>("[list='reason-datalist']");

    if (!urlField || !noSourceBox || !sourceInput || !reasonField) return;

    const url = params.get('url');
    const reason = params.get('reason');
    const source = params.get('source');

    if (!url || !reason || !source) return;

    if (params.has('url')) urlField.value = url;
    if (params.has('reason')) reasonField.value = reason;

    if (params.has('source')) {
      sourceInput.value = source;
    } else if (params.has('url')) {
      noSourceBox.checked = true;
    }

    setTimeout(() => {
      urlField.dispatchEvent(new Event('input'));
      noSourceBox.dispatchEvent(new Event('change'));
      reasonField.dispatchEvent(new Event('input'));
      sourceInput.dispatchEvent(new Event('input'));
    }, 100);

    return;
  }

  if (window.location.pathname == '/posts') {
    // await wait(100);
    const observer = new MutationObserver(checkForNewPosts);
    const targets = await Promise.all([waitForSelector('search-content', 3000), waitForSelector('.posts-container', 1500)]);

    const target = targets[0] ?? targets[1];

    if (!target) return;

    observer.observe(target, { attributes: true, childList: true, subtree: true });

    const vanillaIds = Array.from(document.querySelectorAll('.posts-container > article.thumbnail')).map(p => p.getAttribute('data-id') ?? '-1');
    const re6Ids = Array.from(document.querySelectorAll('post')).map(p => p.id.slice(6));

    console.log(vanillaIds, re6Ids);

    const datas = await getDataBulk(vanillaIds.concat(re6Ids).filter(id => id != '-1'));

    for (const data of datas) {
      processDataOnPostView(data);
    }
    return;
  }

  const container = document.querySelector('#image-container[data-id]');

  if (!container) return;

  const id = parseInt(container.getAttribute('data-id') ?? '-1');

  if (id == -1) {
    console.error('[SourceVerifier] Post ID not found.');
    return;
  };

  try {
    const data = await getData(id);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.source-link')).map(a => a.href);

    const supported = await processData(data, links.length > 0);

    if (links.length == 0) {
      addKemonoData(container.getAttribute('data-file-url')!);
      checkFluffle(id);
    } else if (!supported) {
      checkFluffle(id);
    } else if (await hasCachedFluffleData(id)) {
      checkFluffle(id);
    }

  } catch (e) {
    console.error(e);
  }
}

main();