// Layer 2: the phone fetches noon's search page in a hidden WebView (a normal
// shopper on a normal connection), grabs the embedded JSON, and hands the raw
// text to the backend, which runs the same parseNoonSearch as Layer 1.

import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { noonSearchUrl } from '@skinfix/shared';

const TIMEOUT_MS = 10_000;

// Runs inside noon's page and sends back only what parseNoonSearch reads, so the
// upload is small instead of the whole 2 MB page:
//   1. schema.org JSON-LD + noon's result cards: search cards (data-qa="plp-product-box",
//      first 40, stripped of icons, buttons, inline styles and the long tracking
//      parameter) and productBox cards. This is what noon serves as of 2026-11.
//   2. Next.js data (__NEXT_DATA__ / flight scripts), in case noon goes back to it
//   3. the whole HTML, as a last resort
const GRAB = `(function(){
  function outer(list, max){ var a=[]; for (var i=0;i<list.length && i<max;i++) a.push(list[i].outerHTML); return a.join('\\n'); }
  function slim(el){
    var c = el.cloneNode(true);
    var junk = c.querySelectorAll('svg,button,style,script,noscript');
    for (var i=0;i<junk.length;i++) junk[i].parentNode && junk[i].parentNode.removeChild(junk[i]);
    var all = c.querySelectorAll('*'); for (var j=0;j<all.length;j++) all[j].removeAttribute('style');
    var links = c.querySelectorAll('a[href]');
    for (var k=0;k<links.length;k++) links[k].setAttribute('href', links[k].getAttribute('href').replace(/([?&])pcl=[^&]*&?/, '$1').replace(/[?&]$/, ''));
    return c.outerHTML;
  }
  function send(){
    try {
      var ld = document.querySelectorAll('script[type="application/ld+json"]');
      var plp = document.querySelectorAll('[data-qa="plp-product-box"]');
      var boxes = document.querySelectorAll('a[id^="productBox-"]');
      var cards = [];
      for (var i=0;i<plp.length && i<40;i++) cards.push(slim(plp[i]));
      var hasCards = cards.length || boxes.length;
      var out = (ld.length || hasCards) ? outer(ld, 50) + '\\n' + cards.join('\\n') + '\\n' + outer(boxes, 40) : null;
      if (!hasCards) {
        var nd = document.getElementById('__NEXT_DATA__');
        if (nd && nd.textContent) out = (out || '') + '<script id="__NEXT_DATA__" type="application/json">' + nd.textContent + '</script>';
        var parts = [], s = document.scripts;
        for (var j = 0; j < s.length; j++) { var t = s[j].textContent || ''; if (t.indexOf('self.__next_f') !== -1) parts.push('<script>' + t + '</script>'); }
        if (parts.length) out = (out || '') + parts.join('');
      }
      if (!out) out = document.documentElement.outerHTML;
      window.ReactNativeWebView.postMessage(out);
    } catch (e) { window.ReactNativeWebView.postMessage(''); }
  }
  if (document.readyState === 'complete') setTimeout(send, 800); else window.addEventListener('load', function(){ setTimeout(send, 800); });
})(); true;`;

type Job = { query: string; resolve: (text: string | null) => void };

/**
 * Mount <NoonFetcher /> once on the results screen; call fetchPage(query) to get
 * the page text (or null on timeout / failure). Pages load one at a time.
 */
export function useNoonFetcher() {
  const [job, setJob] = useState<Job | null>(null);
  const current = useRef<Job | null>(null);
  const queue = useRef<Job[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startNext = useRef(() => {});
  const finish = useRef((j: Job, text: string | null) => {
    if (current.current !== j) return; // late message from a finished job
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    j.resolve(text && text.length > 200 ? text : null);
    startNext.current();
  });
  startNext.current = () => {
    const j = queue.current.shift() ?? null;
    current.current = j;
    setJob(j);
    if (j) timer.current = setTimeout(() => finish.current(j, null), TIMEOUT_MS);
  };

  const fetchPage = useCallback(
    (query: string) =>
      new Promise<string | null>((resolve) => {
        queue.current.push({ query, resolve });
        if (!current.current) startNext.current();
      }),
    [],
  );

  const element = job ? (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        key={job.query}
        source={{ uri: noonSearchUrl(job.query), headers: { 'Accept-Language': 'en-AE,en;q=0.9' } }}
        injectedJavaScript={GRAB}
        onMessage={(e: WebViewMessageEvent) => finish.current(job, e.nativeEvent.data)}
        onError={() => finish.current(job, null)}
        onHttpError={() => finish.current(job, null)}
        javaScriptEnabled
        domStorageEnabled
        incognito
        cacheEnabled={false}
      />
    </View>
  ) : null;

  return { fetchPage, element };
}
