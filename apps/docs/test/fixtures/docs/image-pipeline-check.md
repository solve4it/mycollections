---
title: Image pipeline check
description: Build fixture that proves an image in docs/assets reaches the built site.
---

# Image pipeline check

This page is not part of the user guide. It is a fixture: `test/docs-images.test.mjs`
merges it into a throwaway copy of `docs/`, builds the real site from that copy, and
checks that the image below reached the output with a `src` that resolves to a file
the build actually emitted.

![Shared docs image fixture](./assets/image-pipeline-check.png)
