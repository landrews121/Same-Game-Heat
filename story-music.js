(() => {
  const STORY_MUSIC_RECOMMENDATIONS = Object.freeze({
    DAILY_3: Object.freeze({
      title: "Let’s Go",
      artist: "Key Glock",
      manualAddRequired: true
    })
  });

  function getStoryMusicRecommendation(contentType) {
    const recommendation = STORY_MUSIC_RECOMMENDATIONS[String(contentType || "").toUpperCase()];
    return recommendation ? { ...recommendation } : null;
  }

  const storyMusicApi = { STORY_MUSIC_RECOMMENDATIONS, getStoryMusicRecommendation };

  if (typeof window !== "undefined") window.SGHStoryMusic = storyMusicApi;
  if (typeof module !== "undefined" && module.exports) module.exports = storyMusicApi;
})();
