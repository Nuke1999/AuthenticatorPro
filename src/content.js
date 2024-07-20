const { authenticator } = require("otplib");
const { Buffer } = require("buffer");

window.Buffer = Buffer;

(function () {
  let extensionContextInvalidated = false;
  let autoFillDebounceTimer;

  function autoFillAuthInputs(token) {
    if (autoFillDebounceTimer) {
      clearTimeout(autoFillDebounceTimer);
    }
    autoFillDebounceTimer = setTimeout(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      const activeElement = document.activeElement;
      console.log("Found inputs:", inputs);

      inputs.forEach((input) => {
        const inputId = input.id.toLowerCase();
        if (inputId.includes("auth") || inputId.includes("totp")) {
          console.log("Pasting token: ", token);
          input.value = token;

          const inputEvent = new Event("input", { bubbles: true });
          input.dispatchEvent(inputEvent);

          const changeEvent = new Event("change", { bubbles: true });
          input.dispatchEvent(changeEvent);
        }
      });

      if (activeElement && activeElement.focus) {
        activeElement.focus();
      }
    }, 200);
  }

  let checkAndFillDebounceTimer;

  function checkAndFillAuthInputs() {
    if (checkAndFillDebounceTimer) {
      clearTimeout(checkAndFillDebounceTimer);
    }

    checkAndFillDebounceTimer = setTimeout(() => {
      if (
        typeof chrome.runtime === "undefined" ||
        chrome.runtime.id === undefined
      ) {
        console.log(
          "Extension context invalidated, aborting checkAndFillAuthInputs."
        );
        return;
      }

      chrome.runtime.sendMessage({ type: "GET_TAB_URL" }, (response) => {
        const currentTabUrl = response.url;
        if (!currentTabUrl) {
          console.log("Current tab URL not found.");
          return;
        }
        console.log("Current tab URL:", currentTabUrl);

        chrome.storage.local.get(["syncEnabled"], (syncResult) => {
          chrome.storage.local.get(["tokens", "autofillEnabled"], (result) => {
            console.log("chrome.storage content:", result);
            if (result.autofillEnabled) {
              console.log("autofill is enabled");
              const tokens = result.tokens || [];
              tokens.forEach((tokenObj) => {
                const savedUrl = tokenObj.url;
                if (savedUrl && currentTabUrl.includes(savedUrl)) {
                  console.log("condition to fill token met");
                  const otp = tokenObj.otp; // Use the stored OTP
                  autoFillAuthInputs(otp);
                }
              });
            } else {
              console.log("Autofill is disabled.");
            }
          });
        });
      });
    }, 200);
  }

  function updateOTPs() {
    if (chrome.runtime.id === undefined) {
      console.log("Extension context invalidated, aborting updateOTPs.");
      return;
    }

    chrome.storage.local.get(["syncEnabled"], (syncResult) => {
      chrome.storage.local.get(["tokens"], (result) => {
        const tokens = result.tokens || [];
        tokens.forEach((tokenObj, index) => {
          const otp = authenticator.generate(tokenObj.secret);
          tokens[index].otp = otp;
        });
        chrome.storage.local.set({ tokens });
      });
    });
  }

  function alignToInterval() {
    const now = new Date();
    const seconds = now.getSeconds();
    const delay = seconds < 1 || seconds >= 31 ? 60 - seconds : 30 - seconds;

    setTimeout(() => {
      checkAndFillAuthInputs();
      updateOTPs();
      const intervalId = setInterval(() => {
        if (extensionContextInvalidated) {
          clearInterval(intervalId);
          return;
        }
        try {
          checkAndFillAuthInputs();
          updateOTPs();
        } catch (error) {
          console.log("Error accessing chrome.storage.local:", error);
          extensionContextInvalidated = true;
          clearInterval(intervalId);
        }
      }, 30000);
    }, delay * 1000);
  }

  function onVisibilityChange() {
    if (!document.hidden) {
      checkAndFillAuthInputs();
    }
  }

  function onDOMContentLoaded() {
    try {
      checkAndFillAuthInputs();
      alignToInterval();

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes.tokens) {
          console.log("Changes detected in tokens");
          checkAndFillAuthInputs();
          updateOTPs();
          console.log(
            "Tokens updated in content script:",
            changes.tokens.newValue
          );
        }
        if (changes.autofillEnabled) {
          console.log("Changes detected in autofillEnabled");
          checkAndFillAuthInputs();
        }
      });

      document.addEventListener("visibilitychange", onVisibilityChange);
    } catch (error) {
      console.log("Error initializing content script:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onDOMContentLoaded);
  } else {
    onDOMContentLoaded();
  }
})();
