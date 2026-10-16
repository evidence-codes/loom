---
name: capture
description: Take review-grade screenshots of a web page with loom capture — true device widths, stitched full pages that don't stretch 100vh heroes, a reduced-motion still record, settled animations, WebGL, and validity checks (blank regions, broken images, overflow, console errors). Use whenever design work needs screenshots for review, before sending a build to a finish reviewer, or to check a page renders correctly at desktop and mobile widths.
---

# loom capture

```sh
loom capture <url>                                    # 1440x900 + 390x844, first viewport + full page
loom capture <url> --viewports 1440x900,768x1024,390x844@2 --motion both --out .impeccable/review
```

- **Output, per viewport:** `…-first.png`, `…-full.png`, `…-motion-first.png` (with `--motion both`), a `…-frames/` folder (automatic for pinned or fixed scroll scenes), and `manifest.json`.
- **Exit codes:**
  - `2`: a capture is not valid evidence. Read the `capture:` warnings and recapture. Never send an invalid capture to a reviewer.
  - `0`: still read the `page:` and `check:` warnings. Overflow, console errors and failed requests are findings about the page.
- **Default is the still record.** Reduced motion, with every reveal finished. Add `--motion both` when the review must judge motion.
- **Scroll-driven pages** (pinned scenes, fixed WebGL stages) can't be read from one strip; review the frames too.
- **Passing to a reviewer:** list the files and paste the capture notes from the manifest (motion mode, which chrome was hidden after the first slice).
- **Never substitute** a tall-window screenshot or a cropped wide window. That stretches viewport-height heroes, and desktop Chrome can't render below about 500px wide.
