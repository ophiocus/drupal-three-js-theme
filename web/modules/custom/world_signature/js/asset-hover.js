/**
 * Asset teaser hover-autoplay.
 *
 * The asset teaser renders a turntable clip as a muted, looping
 * <video> with autoplay OFF. This behavior plays it on hover and
 * pauses + rewinds on leave — so a listing of assets is still until
 * you point at one, then that one comes alive.
 *
 * The clip itself is produced by the external render platform; this
 * is the only client code the module ships for it.
 */
((Drupal, once) => {
  Drupal.behaviors.worldAssetHover = {
    attach(context) {
      const teasers = once(
        'world-asset-hover',
        '.node--type-asset.node--view-mode-teaser',
        context,
      );
      teasers.forEach((teaser) => {
        const video = teaser.querySelector('video');
        if (!video) {
          return;
        }
        // Enforce the hover-preview contract regardless of formatter
        // markup: muted + looping + no controls, paused at rest.
        video.muted = true;
        video.loop = true;
        video.controls = false;
        video.setAttribute('playsinline', '');
        video.pause();

        const play = () => {
          // play() returns a promise that rejects if interrupted;
          // swallow it — a fast mouse in/out is not an error.
          const p = video.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {});
          }
        };
        const stop = () => {
          video.pause();
          video.currentTime = 0;
        };

        teaser.addEventListener('mouseenter', play);
        teaser.addEventListener('mouseleave', stop);
        // Touch: a tap toggles, since there's no hover on touch.
        teaser.addEventListener('click', () => {
          video.paused ? play() : stop();
        });
      });
    },
  };
})(Drupal, once);
