"use strict";

/* Runtime chroma-key for the original Altair logo asset.
 * The source PNG is intentionally kept in the repository, while the UI uses
 * a transparent in-memory copy so no white tile remains around the blue mark.
 */
(() => {
    async function transparentLogoDataUrl() {
        const image = new Image();
        image.decoding = "async";
        image.src = "assets/altair-logo.png";
        await image.decode();

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || 256;
        canvas.height = image.naturalHeight || 256;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frame.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max - min;

            // White/light neutral background and anti-aliased grey edge.
            if ((min > 165 && saturation < 70) || min > 220) data[i + 3] = 0;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.putImageData(frame, 0, 0);
        return canvas.toDataURL("image/png");
    }

    async function apply() {
        try {
            const dataUrl = await transparentLogoDataUrl();
            document.querySelectorAll('.altairLogo .logoMark img, #v8AboutDialog .aboutHeader img').forEach(img => {
                img.src = dataUrl;
            });
            let favicon = document.querySelector('link[rel="icon"]');
            if (!favicon) {
                favicon = document.createElement("link");
                favicon.rel = "icon";
                document.head.appendChild(favicon);
            }
            favicon.href = dataUrl;
        } catch (error) {
            console.warn("Altair transparent logo processing failed", error);
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(apply, 250), { once: true });
    else setTimeout(apply, 250);
})();
