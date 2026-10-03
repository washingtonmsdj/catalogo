# CatalogPublicationBanner contract

- Demo mode never shows the publication banner.
- Live mode with an unhealthy API leaves API/runtime error handling to the existing surfaces.
- Live mode with a healthy API and zero published catalog items shows the publication-in-progress banner.
- The banner polls every 60 seconds and refreshes when the tab becomes visible, so it disappears without a hard reload after D1 is populated.
- Live mode with one or more catalog items does not show the banner.
