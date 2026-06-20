(() => {
  const candidates = [
    'button[aria-label*="Show transcript"]',
    'button[aria-label*="显示字幕稿"]',
    'button[aria-label*="显示文字记录"]',
    'button[aria-label*="字幕稿"]',
    'button[aria-label*="文字记录"]',
    'ytd-video-description-transcript-section-renderer button',
    'ytd-menu-service-item-renderer button'
  ];

  const clickIfFound = () => {
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node) {
        node.click();
        return true;
      }
    }

    const menuButtons = Array.from(document.querySelectorAll("button, tp-yt-paper-item, ytd-menu-service-item-renderer"));
    for (const button of menuButtons) {
      const text = (button.textContent || "").trim();
      if (!text) {
        continue;
      }
      if (
        text.includes("字幕稿") ||
        text.includes("文字记录") ||
        text.toLowerCase().includes("transcript")
      ) {
        button.click();
        return true;
      }
    }

    return false;
  };

  clickIfFound();
})();
