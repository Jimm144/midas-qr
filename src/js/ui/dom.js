// @ts-check
/**
 * @typedef {Record<string, HTMLElement>} DOMRefs
 */

/** @type {DOMRefs} */
export const DOM = {};

/** @type {string[]} */
const missingIds = [];

/**
 * Look up a required element in `root`; missing ids are collected so initDOM()
 * can report every missing element in one error instead of one per reload.
 * @param {string} id
 * @param {ParentNode} root
 * @returns {HTMLElement}
 */
function safeGetElementById(id, root) {
  // Fast path for the app boot: document.getElementById is a direct id index
  // instead of a selector parse. Injected roots (tests) keep querySelector so
  // ids are resolved inside that root, not the document.
  const el =
    root === document && typeof document.getElementById === "function"
      ? document.getElementById(id)
      : root.querySelector(`#${id}`);
  if (!el) missingIds.push(id);
  // Callers run only after initDOM() has thrown on any missing id.
  return /** @type {HTMLElement} */ (el);
}

/**
 * Populate the shared ref registry from `root` (the document in production,
 * real index.html markup or a minimal element in tests). Throws once with
 * every missing id listed. Idempotent: a frozen registry is left alone.
 * @param {ParentNode} [root]
 */
export function initDOM(root = document) {
  if (Object.isFrozen(DOM)) return;
  missingIds.length = 0;
  const byId = (id) => safeGetElementById(id, root);
  Object.assign(DOM, {
    themeSelect: byId("theme-select"),
    modeSelect: byId("mode-select"),
    languageSelect: byId("language-select"),
    btnThemeToggle: byId("btn-theme-toggle"),
    tabBtnGenerator: byId("tab-btn-generator"),
    tabBtnScanner: byId("tab-btn-scanner"),
    tabBtnHistory: byId("tab-btn-history"),
    panelGenerator: byId("panel-generator"),
    panelScanner: byId("panel-scanner"),
    panelHistory: byId("panel-history"),
    dataType: byId("data-type"),
    inputContainerText: byId("input-container-text"),
    inputText: byId("input-text"),
    inputContainerUrl: byId("input-container-url"),
    inputUrl: byId("input-url"),
    urlWarning: byId("url-warning"),
    inputContainerWifi: byId("input-container-wifi"),
    wifiSsid: byId("wifi-ssid"),
    wifiPass: byId("wifi-pass"),
    wifiEnc: byId("wifi-enc"),
    wifiHidden: byId("wifi-hidden"),
    wifiWarning: byId("wifi-warning"),
    inputContainerContact: byId("input-container-contact"),
    contactFirst: byId("contact-first"),
    contactLast: byId("contact-last"),
    contactOrg: byId("contact-org"),
    contactTitle: byId("contact-title"),
    contactPhone: byId("contact-phone"),
    contactWork: byId("contact-work"),
    contactFax: byId("contact-fax"),
    contactEmail: byId("contact-email"),
    contactUrl: byId("contact-url"),
    contactStreet: byId("contact-street"),
    contactCity: byId("contact-city"),
    contactState: byId("contact-state"),
    contactZip: byId("contact-zip"),
    contactCountry: byId("contact-country"),
    contactWarning: byId("contact-warning"),
    cryptoCoin: byId("crypto-coin"),
    cryptoAddress: byId("crypto-address"),
    cryptoAmount: byId("crypto-amount"),
    cryptoWarning: byId("crypto-warning"),
    inputContainerCrypto: byId("input-container-crypto"),
    geoLat: byId("geo-lat"),
    geoLon: byId("geo-lon"),
    geoWarning: byId("geo-warning"),
    inputContainerGeo: byId("input-container-geo"),
    eventTitle: byId("event-title"),
    eventStart: byId("event-start"),
    eventEnd: byId("event-end"),
    eventLocation: byId("event-location"),
    eventDesc: byId("event-desc"),
    eventWarning: byId("event-warning"),
    inputContainerEvent: byId("input-container-event"),
    smsPhone: byId("sms-phone"),
    smsMsg: byId("sms-msg"),
    smsWarning: byId("sms-warning"),
    inputContainerSms: byId("input-container-sms"),
    phoneNumber: byId("phone-number"),
    phoneWarning: byId("phone-warning"),
    inputContainerPhone: byId("input-container-phone"),
    emailTo: byId("email-to"),
    emailSubject: byId("email-subject"),
    emailBody: byId("email-body"),
    emailWarning: byId("email-warning"),
    inputContainerEmail: byId("input-container-email"),
    colorBgText: byId("color-bg-text"),
    colorDotsText: byId("color-dots-text"),
    colorCornersSquareText: byId("color-cornersSquare-text"),
    colorCornersDotText: byId("color-cornersDot-text"),
    qrWidth: byId("qr-width"),
    qrHeight: byId("qr-height"),
    qrRadius: byId("qr-radius"),
    qrMargin: byId("qr-margin"),
    marginWarning: byId("margin-warning"),
    qrEcc: byId("qr-ecc"),
    qrShapeBody: byId("qr-shape-body"),
    qrShapeOuter: byId("qr-shape-corner-outer"),
    qrShapeInner: byId("qr-shape-corner-inner"),
    qrMaskType: byId("qr-mask-type"),
    qrMaskCustom: byId("qr-mask-custom"),
    maskCustomContainer: byId("mask-custom-container"),
    logoFile: byId("logo-file"),
    btnPickLogo: byId("btn-pick-logo"),
    logoUrl: byId("logo-url"),
    logoOptions: byId("logo-options"),
    logoSize: byId("logo-size"),
    logoMargin: byId("logo-margin"),
    btnClearLogo: byId("btn-clear-logo"),
    logoWarning: byId("logo-warning"),
    bgImageFile: byId("bg-image-file"),
    btnPickBgImage: byId("btn-pick-bg-image"),
    btnClearBgImage: byId("btn-clear-bg-image"),
    bgImageWarning: byId("bg-image-warning"),
    qrFrameStyle: byId("qr-frame-style"),
    colorFrameText: byId("color-frame-text"),
    colorFrameTextColor: byId("color-frame-text-color"),
    qrFrameSize: byId("qr-frame-size"),
    qrFrameTextEnabled: byId("qr-frame-text-enabled"),
    qrFrameFont: byId("qr-frame-font"),
    qrFrameText: byId("qr-frame-text"),
    qrCanvasContainer: byId("qr-canvas-container"),
    qrPreviewContainer: byId("qr-preview-container"),
    qrReadabilityBadge: byId("qr-readability-badge"),
    qrBgTransparent: byId("qr-bg-transparent"),
    bgColorPickerGroup: byId("bg-color-picker-group"),
    emptyStateQr: byId("empty-state-qr"),
    qrLoading: byId("qr-loading"),
    exportFormat: byId("export-format"),
    exportFilename: byId("export-filename"),
    btnDownload: byId("btn-download"),
    btnCopy: byId("btn-copy"),
    btnSave: byId("btn-save"),
    btnShareLink: byId("btn-share-link"),
    batchCsv: byId("batch-csv"),
    btnBatch: byId("btn-batch"),
    batchStatus: byId("batch-status"),
    generatorHistoryList: byId("generator-history-list"),
    btnClearGeneratorHistory: byId("btn-clear-generator-history"),
    btnExportHistoryAll: byId("btn-export-history-all"),
    btnScanWebcam: byId("btn-scan-webcam"),
    btnScanUpload: byId("btn-scan-upload"),
    scannerViewCamera: byId("scanner-view-camera"),
    scannerViewUpload: byId("scanner-view-upload"),
    webcamVideo: byId("webcam-video"),
    cameraLoadingState: byId("camera-loading-state"),
    cameraErrorState: byId("camera-error-state"),
    cameraErrorMsg: byId("camera-error-msg"),
    cameraSelect: byId("camera-select"),
    btnToggleCamera: byId("btn-toggle-camera"),
    scannerReticle: byId("scanner-reticle"),
    dropZone: byId("drop-zone"),
    btnScanPaste: byId("btn-scan-paste"),
    scanFileInput: byId("scan-file-input"),
    uploadedPreviewContainer: byId("uploaded-preview-container"),
    uploadedPreview: byId("uploaded-preview"),
    uploadedFilename: byId("uploaded-filename"),
    uploadedFilesize: byId("uploaded-filesize"),
    btnClearUpload: byId("btn-clear-upload"),
    emptyStateScan: byId("empty-state-scan"),
    scanResultText: byId("scan-result"),
    scanStatusBadge: byId("scan-status-badge"),
    btnCopyResult: byId("btn-copy-result"),
    btnSaveScan: byId("btn-save-scan"),
    btnVisitResult: byId("btn-visit-result"),
    historyList: byId("history-list"),
    btnClearHistory: byId("btn-clear-history"),
    btnCredits: byId("btn-credits"),
    creditsModal: byId("credits-modal"),
    btnCloseCredits: byId("btn-close-credits"),
    errorModal: byId("error-modal"),
    errorModalMsg: byId("error-modal-msg"),
    btnCloseError: byId("btn-close-error"),
  });
  if (missingIds.length > 0) {
    throw new Error(`[DOM] Required element(s) not found: ${missingIds.join(", ")}`);
  }
  Object.freeze(DOM);
}
