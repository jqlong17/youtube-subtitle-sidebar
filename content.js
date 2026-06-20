(function () {
  const PANEL_ID = "yt-subtitle-panel-extension";
  const ACTIVE_ITEM_CLASS = "yt-subtitle-panel__item--active";
  const PAGE_BRIDGE_REQUEST_EVENT = "yt-subtitle-panel-page-request";
  const PAGE_BRIDGE_RESPONSE_EVENT = "yt-subtitle-panel-page-response";
  const TRANSCRIPT_TRIGGER_EVENT = "yt-subtitle-panel-transcript-trigger";
  const PLAYER_CAPTION_SELECTOR = ".ytp-caption-window-container .ytp-caption-segment";
  const TRANSCRIPT_SEGMENT_SELECTOR =
    "ytd-transcript-segment-renderer, ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer";
  let currentVideoId = null;
  let pollTimer = null;
  let syncTimer = null;
  let domCaptionPollTimer = null;
  let transcriptDomPollTimer = null;
  let lastActiveIndex = -1;
  let selectedTrackKey = null;
  let pageBridgeReadyPromise = null;

  start();

  function start() {
    observeNavigation();
    scheduleRender();
  }

  function observeNavigation() {
    let lastHref = location.href;
    const observer = new MutationObserver(() => {
      if (location.href === lastHref) {
        return;
      }
      lastHref = location.href;
      scheduleRender();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleRender() {
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    stopSync();
    stopDomCaptionCapture();
    stopTranscriptDomCapture();
    currentVideoId = getVideoIdFromUrl(location.href);
    removePanel();
    waitForAnchorAndRender(0);
  }

  function waitForAnchorAndRender(attempt) {
    const anchor = findSidebarAnchor();
    if (anchor && currentVideoId) {
      renderPanel(anchor);
      return;
    }
    if (attempt > 40) {
      return;
    }
    pollTimer = setTimeout(() => waitForAnchorAndRender(attempt + 1), 500);
  }

  function findSidebarAnchor() {
    return document.querySelector("#secondary-inner");
  }

  function renderPanel(anchor) {
    const panel = createPanel();
    anchor.prepend(panel.root);
    loadTranscript(panel).catch((error) => {
      updateStatus(panel, `字幕加载失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function createPanel() {
    const root = document.createElement("section");
    root.id = PANEL_ID;
    root.className = "yt-subtitle-panel";
    root.innerHTML = [
      '<div class="yt-subtitle-panel__header">',
      '<h2 class="yt-subtitle-panel__title">字幕</h2>',
      '<div class="yt-subtitle-panel__actions">',
      '<select class="yt-subtitle-panel__language" disabled></select>',
      '<button class="yt-subtitle-panel__copy" type="button" disabled>复制 SRT</button>',
      "</div>",
      "</div>",
      '<div class="yt-subtitle-panel__status">正在查找字幕轨...</div>',
      '<div class="yt-subtitle-panel__body" hidden>',
      '<ol class="yt-subtitle-panel__list"></ol>',
      "</div>",
      '<div class="yt-subtitle-panel__footer">仅显示当前页面可解析的 YouTube 字幕。</div>'
    ].join("");

    return {
      root,
      status: root.querySelector(".yt-subtitle-panel__status"),
      body: root.querySelector(".yt-subtitle-panel__body"),
      list: root.querySelector(".yt-subtitle-panel__list"),
      languageSelect: root.querySelector(".yt-subtitle-panel__language"),
      copyButton: root.querySelector(".yt-subtitle-panel__copy"),
      segments: [],
      tracks: []
    };
  }

  async function loadTranscript(panel) {
    const playerResponse = await getPlayerResponse();
    panel.tracks = getAvailableCaptionTracks(playerResponse);
    bindLanguageSelect(panel);
    populateLanguageOptions(panel);
    const captionTrack = getSelectedCaptionTrack(panel);
    if (!captionTrack?.baseUrl) {
      updateStatus(panel, "这个视频没有可解析字幕。");
      return;
    }

    updateStatus(panel, `正在加载字幕：${getTrackLabel(captionTrack)}`);
    let segments = [];
    const fetchErrors = [];
    const json3Payload = await fetchCaptionPayloadSafe(captionTrack.baseUrl, "json3", fetchErrors);
    segments = parseTranscriptPayload(json3Payload);

    if (!segments.length) {
      const srv3Payload = await fetchCaptionPayloadSafe(captionTrack.baseUrl, "srv3", fetchErrors);
      segments = parseTranscriptPayload(srv3Payload);

      if (!segments.length) {
        const defaultPayload = await fetchCaptionPayloadSafe(captionTrack.baseUrl, null, fetchErrors);
        segments = parseTranscriptPayload(defaultPayload);
        if (!segments.length) {
          if (fetchErrors.length) {
            updateStatus(panel, `字幕轨请求受限，正在尝试备用方式：${summarizeFetchErrors(fetchErrors)}`);
          }
          const transcriptDomLoaded = await tryLoadTranscriptFromYouTubeDom(panel, captionTrack);
          if (!transcriptDomLoaded && !startDomCaptionCapture(panel)) {
            const errorSummary = summarizeFetchErrors(fetchErrors);
            updateStatus(
              panel,
              `字幕轨存在，但没有解析到正文。${errorSummary} 调试：json3=${summarizePayload(json3Payload)} srv3=${summarizePayload(srv3Payload)} default=${summarizePayload(defaultPayload)}`
            );
          }
          return;
        }
      }
    }

    panel.segments = segments;
    renderSegments(panel, segments);
    bindSegmentClick(panel);
    bindCopy(panel);
    startSync(panel);
    updateStatus(panel, `已加载 ${segments.length} 条字幕。`);
  }

  function getAvailableCaptionTracks(playerResponse) {
    const renderer = playerResponse?.captions?.playerCaptionsTracklistRenderer;
    const tracks = renderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length) {
      return enrichCaptionTracks(tracks);
    }

    const fallbackTracks = getCaptionTracksFromHtml();
    if (fallbackTracks.length) {
      return fallbackTracks;
    }

    return [];
  }

  function getSelectedCaptionTrack(panel) {
    if (!panel.tracks.length) {
      return null;
    }

    const fallbackTrack = pickPreferredTrack(panel.tracks);
    if (!selectedTrackKey) {
      selectedTrackKey = getTrackKey(fallbackTrack);
    }

    return panel.tracks.find((track) => getTrackKey(track) === selectedTrackKey) ?? fallbackTrack;
  }

  function enrichCaptionTracks(tracks) {
    return Array.isArray(tracks) ? tracks.filter((track) => track?.baseUrl && track?.languageCode) : [];
  }

  async function getPlayerResponse() {
    const bridgedResponse = await getPlayerResponseFromPageBridge();
    if (bridgedResponse) {
      return bridgedResponse;
    }

    const scriptResponse = getPlayerResponseFromInlineScripts();
    if (scriptResponse) {
      return scriptResponse;
    }

    const playerDataScript = document.querySelector("ytd-watch-flexy script");
    if (playerDataScript?.textContent) {
      const parsed = extractJsonAssignment(playerDataScript.textContent, "ytInitialPlayerResponse");
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function getPlayerResponseFromPageBridge() {
    return callPageBridge("getPlayerResponse", {}, 1500)
      .then((detail) => detail?.playerResponse ?? null)
      .catch(() => null);
  }

  function getCaptionTracksFromHtml() {
    const html = document.documentElement.innerHTML;
    const marker = '"captionTracks":';
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
      return [];
    }

    const startIndex = html.indexOf("[", markerIndex);
    if (startIndex === -1) {
      return [];
    }

    const jsonText = extractBalancedArray(html, startIndex);
    if (!jsonText) {
      return [];
    }

    const tracks = safeJsonParse(jsonText);
    return Array.isArray(tracks) ? tracks : [];
  }

  function pickPreferredTrack(tracks) {
    const preferredLanguages = ["zh-Hans", "zh-CN", "zh", "zh-Hant", "en"];
    for (const language of preferredLanguages) {
      const matched = tracks.find((track) => track.languageCode === language);
      if (matched) {
        return matched;
      }
    }

    return tracks[0] ?? null;
  }

  function populateLanguageOptions(panel) {
    panel.languageSelect.innerHTML = "";
    if (!panel.tracks.length) {
      panel.languageSelect.disabled = true;
      return;
    }

    const preferredTrack = pickPreferredTrack(panel.tracks);
    if (!selectedTrackKey) {
      selectedTrackKey = getTrackKey(preferredTrack || panel.tracks[0] || null);
    }

    const seen = new Set();
    for (const track of panel.tracks) {
      const trackKey = getTrackKey(track);
      if (!track.languageCode || !trackKey || seen.has(trackKey)) {
        continue;
      }
      seen.add(trackKey);
      const option = document.createElement("option");
      option.value = trackKey;
      option.textContent = getTrackLabel(track);
      option.selected = trackKey === selectedTrackKey;
      panel.languageSelect.appendChild(option);
    }

    panel.languageSelect.disabled = false;
  }

  function bindLanguageSelect(panel) {
    if (panel.languageSelect.dataset.bound === "true") {
      return;
    }
    panel.languageSelect.dataset.bound = "true";
    panel.languageSelect.addEventListener("change", () => {
      selectedTrackKey = panel.languageSelect.value || null;
      stopSync();
      stopDomCaptionCapture();
      stopTranscriptDomCapture();
      panel.segments = [];
      panel.list.innerHTML = "";
      panel.body.hidden = true;
      panel.copyButton.disabled = true;
      loadTranscript(panel).catch((error) => {
        updateStatus(panel, `字幕加载失败：${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  function getTrackLabel(track) {
    const simpleName =
      track?.name?.simpleText ||
      (Array.isArray(track?.name?.runs) ? track.name.runs.map((item) => item.text).join("") : null);
    const kind = Array.isArray(track?.kind) ? track.kind.join(",") : track?.kind;
    if (simpleName && kind === "asr") {
      return `${simpleName} (自动)`;
    }
    if (simpleName) {
      return simpleName;
    }
    return track.languageCode || "unknown";
  }

  function getTrackKey(track) {
    if (!track) {
      return null;
    }

    const languageCode = track.languageCode || "unknown";
    const kind = Array.isArray(track?.kind) ? track.kind.join(",") : track?.kind || "default";
    const vssId = track.vssId || "";
    return `direct:${languageCode}:${kind}:${vssId}`;
  }

  function getPlayerResponseFromInlineScripts() {
    const scripts = Array.from(document.scripts);
    for (const script of scripts) {
      const text = script.textContent;
      if (!text || !text.includes("ytInitialPlayerResponse")) {
        continue;
      }

      const parsed = extractJsonAssignment(text, "ytInitialPlayerResponse");
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function extractJsonAssignment(source, variableName) {
    const marker = `${variableName} = `;
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const startIndex = source.indexOf("{", markerIndex);
    if (startIndex === -1) {
      return null;
    }

    const jsonText = extractBalancedJson(source, startIndex);
    if (!jsonText) {
      return null;
    }

    return safeJsonParse(jsonText);
  }

  function extractBalancedJson(source, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return null;
  }

  function extractBalancedArray(source, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return null;
  }

  async function fetchCaptionPayload(baseUrl, format) {
    const url = new URL(baseUrl);
    if (format) {
      url.searchParams.set("fmt", format);
    } else {
      url.searchParams.delete("fmt");
    }
    const response = await fetch(url.toString(), {
      credentials: "include",
      mode: "cors"
    });
    if (!response.ok) {
      if (response.status === 429) {
        return fetchCaptionPayloadFromPageBridge(url.toString(), format);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  }

  function fetchCaptionPayloadFromPageBridge(url, format) {
    return callPageBridge("fetchCaption", { url, format: format || "" }, 4000).then((detail) => detail?.payload || "");
  }

  function runPlayerActionOnPageBridge(action, payload) {
    return callPageBridge(action, payload || {}, 4000).then((detail) => detail?.result ?? null);
  }

  function getCurrentCaptionTrackStateFromPageBridge() {
    return callPageBridge("getCurrentCaptionTrack", {}, 2000).then((detail) => detail?.track || null).catch(() => null);
  }

  async function ensurePageBridgeReady() {
    if (pageBridgeReadyPromise) {
      return pageBridgeReadyPromise;
    }

    pageBridgeReadyPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("yt-subtitle-page-bridge-script");
      if (existing) {
        if (existing.dataset.ready === "true") {
          resolve();
          return;
        }

        const handleLoad = () => {
          existing.dataset.ready = "true";
          existing.removeEventListener("load", handleLoad);
          existing.removeEventListener("error", handleError);
          resolve();
        };
        const handleError = () => {
          existing.removeEventListener("load", handleLoad);
          existing.removeEventListener("error", handleError);
          reject(new Error("Failed to load page bridge"));
        };

        existing.addEventListener("load", handleLoad, { once: true });
        existing.addEventListener("error", handleError, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = "yt-subtitle-page-bridge-script";
      script.src = chrome.runtime.getURL("page-bridge.js");
      script.async = false;
      script.onload = () => {
        script.dataset.ready = "true";
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load page bridge"));
      (document.documentElement || document.head || document.body).appendChild(script);
    }).catch((error) => {
      pageBridgeReadyPromise = null;
      throw error;
    });

    return pageBridgeReadyPromise;
  }

  async function callPageBridge(action, payload, timeoutMs) {
    await ensurePageBridgeReady();

    return new Promise((resolve, reject) => {
      const requestId = `yt-page-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let settled = false;

      const cleanup = () => {
        window.removeEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
        if (timer) {
          clearTimeout(timer);
        }
      };

      const finishResolve = (detail) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(detail);
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const onResponse = (event) => {
        const detail = event.detail;
        if (!detail || detail.requestId !== requestId) {
          return;
        }
        if (detail.error) {
          finishReject(new Error(detail.error));
          return;
        }
        finishResolve(detail);
      };

      const timer = window.setTimeout(() => {
        finishReject(new Error("Page bridge timeout"));
      }, timeoutMs);

      window.addEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
      window.dispatchEvent(
        new CustomEvent(PAGE_BRIDGE_REQUEST_EVENT, {
          detail: {
            requestId,
            action,
            payload: payload || {}
          }
        })
      );
    });
  }

  async function fetchCaptionPayloadSafe(baseUrl, format, fetchErrors) {
    try {
      return await fetchCaptionPayload(baseUrl, format);
    } catch (error) {
      fetchErrors.push({
        format: format || "default",
        message: error instanceof Error ? error.message : String(error)
      });
      return "";
    }
  }

  function summarizeFetchErrors(fetchErrors) {
    if (!Array.isArray(fetchErrors) || !fetchErrors.length) {
      return "";
    }

    return `请求字幕轨失败：${fetchErrors.map((item) => `${item.format}=${item.message}`).join(" ")}。`;
  }

  function parseTranscriptPayload(payloadText) {
    const payload = payloadText.trim();
    if (!payload) {
      return [];
    }

    if (payload.startsWith("{")) {
      return parseTranscriptJson3(payload);
    }

    if (payload.startsWith("<")) {
      return parseTranscriptXml(payload);
    }

    return [];
  }

  function parseTranscriptJson3(jsonText) {
    const data = safeJsonParse(jsonText);
    const events = Array.isArray(data?.events) ? data.events : [];
    return events
      .map((event) => {
        const segs = Array.isArray(event?.segs) ? event.segs : [];
        const text = normalizeCaptionText(
          segs
            .map((segment) => decodeHtml(segment?.utf8 || ""))
            .join("")
        );
        if (!text) {
          return null;
        }
        return {
          start: Number(event.tStartMs || 0) / 1000,
          dur: Number(event.dDurationMs || 0) / 1000,
          text
        };
      })
      .filter(Boolean);
  }

  function parseTranscriptXml(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");
    const textNodes = Array.from(xml.getElementsByTagName("text"));
    if (textNodes.length) {
      return textNodes
        .map((node) => {
          const start = Number(node.getAttribute("start") || "0");
          const dur = Number(node.getAttribute("dur") || "0");
          const raw = decodeHtml(node.textContent || "");
          const text = normalizeCaptionText(raw);
          if (!text) {
            return null;
          }
          return {
            start,
            dur,
            text
          };
        })
        .filter(Boolean);
    }

    const paragraphNodes = Array.from(xml.getElementsByTagName("p"));
    if (paragraphNodes.length) {
      return paragraphNodes
        .map((node) => {
          const startMs = Number(node.getAttribute("t") || "0");
          const durMs = Number(node.getAttribute("d") || "0");
          const segments = Array.from(node.getElementsByTagName("s"));
          const rawText = segments.length
            ? segments.map((segment) => decodeHtml(segment.textContent || "")).join(" ")
            : decodeHtml(node.textContent || "");
          const text = normalizeCaptionText(rawText);
          if (!text) {
            return null;
          }
          return {
            start: startMs / 1000,
            dur: durMs / 1000,
            text
          };
        })
        .filter(Boolean);
    }

    return [];
  }

  function renderSegments(panel, segments) {
    panel.list.innerHTML = segments
      .map((segment, index) => renderSegmentHtml(index, segment))
      .join("");
    panel.body.hidden = false;
  }

  function renderSegmentHtml(index, segment) {
    const end = segment.start + Math.max(segment.dur, 0.01);
    return [
      `<li class="yt-subtitle-panel__item" data-index="${index}" data-start="${segment.start}" data-end="${end}">`,
      `<div class="yt-subtitle-panel__time">${formatTime(segment.start)}</div>`,
      `<div class="yt-subtitle-panel__text">${escapeHtml(segment.text)}</div>`,
      "</li>"
    ].join("");
  }

  function appendSegment(panel, segment) {
    const index = panel.segments.length - 1;
    panel.list.insertAdjacentHTML("beforeend", renderSegmentHtml(index, segment));
    const item = panel.list.querySelector(`[data-index="${index}"]`);
    if (item) {
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function bindSegmentClick(panel) {
    if (panel.list.dataset.segmentClickBound === "true") {
      return;
    }
    panel.list.dataset.segmentClickBound = "true";
    panel.list.addEventListener("click", (event) => {
      const item = event.target instanceof Element ? event.target.closest(".yt-subtitle-panel__item") : null;
      if (!item) {
        return;
      }

      const start = Number(item.getAttribute("data-start") || "0");
      const video = getVideoElement();
      if (!video) {
        return;
      }

      video.currentTime = Math.max(0, start);
      void video.play().catch(() => {});
      updateActiveSegment(panel, video.currentTime, true);
    });
  }

  function bindCopy(panel) {
    panel.copyButton.disabled = panel.segments.length === 0;
    if (panel.copyButton.dataset.copyBound === "true") {
      return;
    }
    panel.copyButton.dataset.copyBound = "true";
    panel.copyButton.addEventListener("click", async () => {
      if (!panel.segments.length) {
        return;
      }

      const originalText = panel.copyButton.textContent;
      try {
        await navigator.clipboard.writeText(buildSrt(panel.segments));
        panel.copyButton.textContent = "已复制";
      } catch (error) {
        console.error("Failed to copy SRT", error);
        panel.copyButton.textContent = "复制失败";
      }

      window.setTimeout(() => {
        panel.copyButton.textContent = originalText;
      }, 1200);
    });
  }

  function startSync(panel) {
    stopSync();
    const tick = () => {
      const video = getVideoElement();
      if (!video || video.readyState === 0) {
        syncTimer = window.setTimeout(tick, 500);
        return;
      }

      updateActiveSegment(panel, video.currentTime, false);
      syncTimer = window.setTimeout(tick, 250);
    };

    tick();
  }

  function stopSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    lastActiveIndex = -1;
  }

  function startDomCaptionCapture(panel) {
    const video = getVideoElement();
    if (!video) {
      return false;
    }

    panel.segments = [];
    panel.list.innerHTML = "";
    panel.body.hidden = false;
    bindSegmentClick(panel);
    bindCopy(panel);
    panel.copyButton.disabled = true;
    startSync(panel);
    updateStatus(panel, "正在从播放器实时捕获字幕。这不是全量字幕，仅会随播放逐步累积。");

    const seen = new Set();
    let lastText = "";
    const capture = () => {
      const currentTexts = Array.from(document.querySelectorAll(PLAYER_CAPTION_SELECTOR))
        .map((node) => normalizeCaptionText(node.textContent || ""))
        .filter(Boolean);

      const merged = normalizeCaptionText(currentTexts.join(" "));
      if (merged) {
        const roundedTime = Math.floor(video.currentTime * 10) / 10;
        const key = `${Math.floor(video.currentTime)}|${merged}`;
        if (merged !== lastText && !seen.has(key)) {
          seen.add(key);
          lastText = merged;
          const segment = {
            start: roundedTime,
            dur: 2,
            text: merged
          };
          panel.segments.push(segment);
          appendSegment(panel, segment);
          updateStatus(panel, `实时字幕捕获中：${panel.segments.length} 条`);
        }
      }

      domCaptionPollTimer = window.setTimeout(capture, 300);
    };

    capture();
    return true;
  }

  function stopDomCaptionCapture() {
    if (domCaptionPollTimer) {
      clearTimeout(domCaptionPollTimer);
      domCaptionPollTimer = null;
    }
  }

  async function tryLoadTranscriptFromYouTubeDom(panel, captionTrack) {
    updateStatus(panel, "正在尝试打开 YouTube 自带字幕稿...");
    let effectiveTrack = captionTrack;
    if (captionTrack?.languageCode) {
      try {
        await runPlayerActionOnPageBridge("setCaptionTrack", {
          languageCode: captionTrack.languageCode,
          sourceLanguageCode: captionTrack.languageCode
        });
        await wait(600);
        const activeTrackState = await getCurrentCaptionTrackStateFromPageBridge();
        const resolvedTrack = resolveTrackFromPlayerState(panel, activeTrackState);
        if (resolvedTrack) {
          effectiveTrack = resolvedTrack;
          selectedTrackKey = getTrackKey(resolvedTrack);
          populateLanguageOptions(panel);
        } else if (activeTrackState) {
          updateStatus(
            panel,
            `播放器实际字幕轨与所选语言不一致。source=${activeTrackState.languageCode || "unknown"} target=${
              activeTrackState.translationLanguage?.languageCode || "none"
            }`
          );
        }
      } catch {
        // Some pages block player-side caption switching; transcript DOM loading can still succeed.
      }
    }

    triggerYouTubeTranscriptPanel();
    const segments = await waitForTranscriptDomSegments();
    if (!segments.length) {
      return false;
    }

    panel.segments = dedupeSegments(segments);
    renderSegments(panel, panel.segments);
    bindSegmentClick(panel);
    bindCopy(panel);
    startSync(panel);
    updateStatus(panel, `已从 YouTube 字幕稿加载 ${panel.segments.length} 条字幕：${getTrackLabel(effectiveTrack)}。`);
    return true;
  }

  function resolveTrackFromPlayerState(panel, activeTrackState) {
    if (!panel?.tracks?.length || !activeTrackState) {
      return null;
    }

    const sourceLanguageCode = activeTrackState.languageCode || null;
    const targetLanguageCode = activeTrackState.translationLanguage?.languageCode || null;

    if (sourceLanguageCode) {
      const exactVssId = activeTrackState.vss_id || activeTrackState.vssId || null;
      return (
        panel.tracks.find(
          (track) =>
            track.languageCode === sourceLanguageCode && (!exactVssId || track.vssId === exactVssId)
        ) ||
        panel.tracks.find((track) => track.languageCode === sourceLanguageCode) ||
        null
      );
    }

    return null;
  }

  function triggerYouTubeTranscriptPanel() {
    const requestId = `yt-transcript-trigger-${Date.now()}`;
    window.__YT_SUBTITLE_PANEL_REQUEST_ID__ = requestId;
    window.__YT_SUBTITLE_PANEL_EVENT_NAME__ = TRANSCRIPT_TRIGGER_EVENT;

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("transcript-trigger.js");
    script.async = false;
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  function waitForTranscriptDomSegments() {
    return new Promise((resolve) => {
      let attempts = 0;
      let isCollecting = false;

      const poll = async () => {
        const segments = readTranscriptDomSegments();
        const scrollContainer = findTranscriptScrollContainer();

        if (segments.length && scrollContainer && !isCollecting) {
          isCollecting = true;
          const allSegments = await collectAllTranscriptDomSegments(scrollContainer, segments);
          resolve(allSegments);
          return;
        }

        if (segments.length && !scrollContainer) {
          resolve(segments);
          return;
        }

        attempts += 1;
        if (attempts > 40) {
          resolve([]);
          return;
        }

        transcriptDomPollTimer = window.setTimeout(poll, 300);
      };

      poll();
    });
  }

  function stopTranscriptDomCapture() {
    if (transcriptDomPollTimer) {
      clearTimeout(transcriptDomPollTimer);
      transcriptDomPollTimer = null;
    }
  }

  function findTranscriptScrollContainer() {
    const selectors = [
      "ytd-transcript-search-panel-renderer #segments-container",
      "ytd-transcript-search-panel-renderer #body",
      "ytd-transcript-renderer #segments-container",
      "ytd-transcript-renderer #body",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] #content",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] #body"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) {
        return node;
      }
    }

    const firstSegment = document.querySelector(TRANSCRIPT_SEGMENT_SELECTOR);
    let current = firstSegment instanceof HTMLElement ? firstSegment.parentElement : null;
    while (current) {
      if (current.scrollHeight > current.clientHeight + 20) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  async function collectAllTranscriptDomSegments(scrollContainer, initialSegments) {
    const seenKeys = new Set();
    let bestSegments = dedupeSegments(initialSegments);
    let stableRounds = 0;
    let previousScrollTop = -1;

    for (const segment of bestSegments) {
      seenKeys.add(`${segment.start}|${segment.text}`);
    }

    const maxRounds = 120;
    for (let round = 0; round < maxRounds; round += 1) {
      await wait(180);
      const currentSegments = dedupeSegments(readTranscriptDomSegments());
      let added = false;

      for (const segment of currentSegments) {
        const key = `${segment.start}|${segment.text}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        bestSegments.push(segment);
        added = true;
      }

      bestSegments.sort((a, b) => a.start - b.start);

      const reachedBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 8;
      if (reachedBottom && !added) {
        stableRounds += 1;
      } else if (!added && scrollContainer.scrollTop === previousScrollTop) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      if (stableRounds >= 3) {
        break;
      }

      previousScrollTop = scrollContainer.scrollTop;
      const nextScrollTop = Math.min(
        scrollContainer.scrollTop + Math.max(400, Math.floor(scrollContainer.clientHeight * 0.9)),
        scrollContainer.scrollHeight
      );
      scrollContainer.scrollTop = nextScrollTop;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    scrollContainer.scrollTop = 0;
    return bestSegments;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function readTranscriptDomSegments() {
    const items = Array.from(document.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR));
    return items
      .map((item) => {
        const timeNode =
          item.querySelector("#start-offset") ||
          item.querySelector(".segment-timestamp") ||
          item.querySelector("yt-formatted-string[segment-timestamp]");
        const textNode =
          item.querySelector("#segment-text") ||
          item.querySelector(".segment-text") ||
          item.querySelector("yt-formatted-string");

        const timeText = normalizeCaptionText(timeNode?.textContent || "");
        const text = normalizeCaptionText(textNode?.textContent || "");
        const start = parseDisplayedTime(timeText);
        if (!text || Number.isNaN(start)) {
          return null;
        }

        return {
          start,
          dur: 2,
          text
        };
      })
      .filter(Boolean);
  }

  function parseDisplayedTime(value) {
    const parts = value.split(":").map((part) => Number(part.trim()));
    if (!parts.length || parts.some((part) => Number.isNaN(part))) {
      return Number.NaN;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return Number.NaN;
  }

  function dedupeSegments(segments) {
    const deduped = [];
    const seen = new Set();
    for (const segment of segments) {
      const key = `${segment.start}|${segment.text}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(segment);
    }
    return deduped;
  }

  function buildSrt(segments) {
    return segments
      .map((segment, index) => {
        const start = formatSrtTime(segment.start);
        const end = formatSrtTime(segment.start + Math.max(segment.dur, 2));
        return `${index + 1}\n${start} --> ${end}\n${segment.text}`;
      })
      .join("\n\n");
  }

  function formatSrtTime(seconds) {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }

  function updateActiveSegment(panel, currentTime, shouldScroll) {
    const index = panel.segments.findIndex((segment) => {
      const start = segment.start;
      const end = segment.start + Math.max(segment.dur, 0.01);
      return currentTime >= start && currentTime < end;
    });

    if (index === lastActiveIndex) {
      return;
    }

    const previous = panel.list.querySelector(`.${ACTIVE_ITEM_CLASS}`);
    if (previous) {
      previous.classList.remove(ACTIVE_ITEM_CLASS);
    }

    lastActiveIndex = index;
    if (index === -1) {
      return;
    }

    const next = panel.list.querySelector(`[data-index="${index}"]`);
    if (!next) {
      return;
    }

    next.classList.add(ACTIVE_ITEM_CLASS);
    if (shouldScroll || !isElementFullyVisible(next, panel.body)) {
      next.scrollIntoView({ block: "nearest", behavior: shouldScroll ? "smooth" : "auto" });
    }
  }

  function isElementFullyVisible(element, container) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
  }

  function updateStatus(panel, message) {
    panel.status.textContent = message;
  }

  function removePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
    }
  }

  function getVideoElement() {
    return document.querySelector("video");
  }

  function getVideoIdFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.hostname.includes("youtube.com")) {
        return url.searchParams.get("v");
      }
      if (url.hostname === "youtu.be") {
        return url.pathname.slice(1);
      }
      return null;
    } catch {
      return null;
    }
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function normalizeCaptionText(value) {
    return value
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function summarizePayload(value) {
    if (!value) {
      return "empty";
    }

    const compact = value.replace(/\s+/g, " ").trim();
    return compact.slice(0, 120);
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
})();
