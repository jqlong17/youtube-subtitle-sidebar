(() => {
  if (window.__YT_SUBTITLE_PAGE_BRIDGE_READY__) {
    return;
  }

  const REQUEST_EVENT = "yt-subtitle-panel-page-request";
  const RESPONSE_EVENT = "yt-subtitle-panel-page-response";

  window.__YT_SUBTITLE_PAGE_BRIDGE_READY__ = true;

  window.addEventListener(REQUEST_EVENT, (event) => {
    const detail = event.detail || {};
    const requestId = detail.requestId;
    const action = detail.action;
    const payload = detail.payload || {};

    if (!requestId || !action) {
      return;
    }

    handleAction(action, payload)
      .then((result) => {
        dispatch({ requestId, ...result });
      })
      .catch((error) => {
        dispatch({
          requestId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  });

  function dispatch(detail) {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail
      })
    );
  }

  async function handleAction(action, payload) {
    if (action === "getPlayerResponse") {
      return {
        playerResponse: getPlayerResponse()
      };
    }

    if (action === "fetchCaption") {
      const response = await fetch(payload.url, {
        credentials: "include",
        mode: "cors"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return {
        payload: await response.text()
      };
    }

    if (action === "setCaptionTrack") {
      setCaptionTrack(payload);
      return {
        result: true
      };
    }

    if (action === "getCurrentCaptionTrack") {
      return {
        track: getCurrentCaptionTrack()
      };
    }

    throw new Error(`Unknown action: ${action}`);
  }

  function getPlayerResponse() {
    const player = document.getElementById("movie_player");
    if (player && typeof player.getPlayerResponse === "function") {
      return player.getPlayerResponse();
    }

    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }

    return null;
  }

  function setCaptionTrack(payload) {
    const player = document.getElementById("movie_player");
    if (!player) {
      throw new Error("Player not found");
    }

    if (typeof player.setOption !== "function") {
      throw new Error("Player setOption unavailable");
    }

    const languageCode = payload?.languageCode;
    const translationLanguageCode = payload?.translationLanguageCode;
    const sourceLanguageCode = payload?.sourceLanguageCode;

    const track = {
      languageCode: sourceLanguageCode || languageCode
    };

    if (translationLanguageCode) {
      track.translationLanguage = {
        languageCode: translationLanguageCode
      };
    }

    player.setOption("captions", "track", track);
    player.setOption("captions", "reload", true);
  }

  function getCurrentCaptionTrack() {
    const player = document.getElementById("movie_player");
    if (!player || typeof player.getOption !== "function") {
      return null;
    }

    try {
      return player.getOption("captions", "track") || null;
    } catch {
      return null;
    }
  }
})();
