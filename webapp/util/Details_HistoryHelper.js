sap.ui.define([], function () {
  "use strict";

  return {
    onIconTabSelect: function (oController, oEvent) {
      if (oEvent.getParameter("key") !== "history") {
        return;
      }

      const oHistory = oController.getView().getModel("history");
      const sDocId = oController._getCurrentDocumentId?.();

      if (!oHistory || !sDocId) {
        return;
      }

      const aLogs = oHistory.getProperty("/logs") || [];
      const sLastDocId = oHistory.getProperty("/lastDocId");

      // Wenn Logs fehlen oder DocId gewechselt hat → laden
      if (!aLogs.length || sLastDocId !== sDocId) {
        oHistory.setProperty("/lastDocId", sDocId);
        return this.loadHistoryLogs(oController);
      }
    },

    loadHistoryLogs: async function (oController, bForce, bClearImmediately) {
      const oHistory = oController.getView().getModel("history");
      const oAuth = oController.getOwnerComponent().getModel("auth");
      if (!oHistory) { return; }

      const bDoForce = !!bForce;
      const bDoClear = (bClearImmediately !== undefined) ? !!bClearImmediately : bDoForce;

      const sType = oAuth?.getProperty("/tokenType");
      const sTok  = oAuth?.getProperty("/token");
      const sDocId = oController._getCurrentDocumentId?.();

      if (!sDocId) {
        oHistory.setProperty("/lastDocId", "");
        oHistory.setProperty("/logs", []);
        oHistory.setProperty("/billingId", "");     // ✅ NEU: reset
        oHistory.setProperty("/historyDocId", "");  // ✅ optional
        return;
      }

      const sLastDocId = oHistory.getProperty("/lastDocId");
      if (!bDoForce && sLastDocId === sDocId) {
        return;
      }

      if (bDoClear) {
        oHistory.setProperty("/logs", []);
      }

      // Cache markieren (damit parallele Calls nicht doppelt feuern)
      oHistory.setProperty("/lastDocId", sDocId);

      if (!sTok) {
        oHistory.setProperty("/logs", [{
          message: "No auth token available.",
          date: new Date(),
          code: "",
          statusText: "Information",
          statusState: "Information"
        }]);
        oHistory.setProperty("/billingId", ""); // ✅ NEU
        return;
      }

      oHistory.setProperty("/busy", true);

      try {
        const sBase = "https://test.app.clarc.com:443/application/api/v1/documenthub";
        const sUrl1 = `${sBase}/document(${encodeURIComponent(sDocId)})`;
        const sUrl2 = `${sBase}/document/${encodeURIComponent(sDocId)}`;

        const oHeaders = {
          "Authorization": `${sType} ${sTok}`,
          "Accept": "application/json"
        };

        let oData;
        try {
          const r1 = await fetch(sUrl1, { method: "GET", headers: oHeaders });
          if (!r1.ok) throw new Error(`HTTP ${r1.status} ${r1.statusText}`);
          oData = await r1.json();
        } catch (e1) {
          const r2 = await fetch(sUrl2, { method: "GET", headers: oHeaders });
          if (!r2.ok) throw new Error(`HTTP ${r2.status} ${r2.statusText}`);
          oData = await r2.json();
        }
        //das ganze Dokument cachen, um ihn später mit PATCH API Call beim Speichern des Panels "Save" Button zu versenden
        const oDocCache = oController.getView().getModel("docCache");
        if (oDocCache) {
          oDocCache.setProperty("/docId", sDocId);
          oDocCache.setProperty("/doc", oData);          
          oDocCache.setProperty("/fetchedAt", Date.now());
        }
        // ✅ NEU: BillingId aus History-Response ablegen
        const sBillingId = (oData?.Process?.Manager?.Id || "").trim();
        oHistory.setProperty("/billingId", sBillingId);
        oHistory.setProperty("/historyDocId", (oData?.Id || "").trim()); // optional

        const aChangeLog = Array.isArray(oData?.ChangeLog) ? oData.ChangeLog : [];
        const sDocState = oData?.State || "";

        const aLogs = aChangeLog
          .map((x) => {
            const oDateRaw = x?.Date;
            const nMs = oDateRaw?.$date ?? oDateRaw;
            const d = nMs ? new Date(nMs) : new Date();

            const sMsg = x?.Text || "";
            const sCode = x?.Code || "";
            const sTypeLog = x?.Type || "";

            const oStatus = this.mapHistoryStatus(sDocState, sTypeLog, sCode, sMsg);

            return {
              message: this.buildHistoryMessage(x),
              date: d,
              code: sCode,
              statusText: oStatus.text,
              statusState: oStatus.state
            };
          })
          .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));

        oHistory.setProperty("/logs", aLogs);

      } catch (err) {
        oHistory.setProperty("/logs", [{
          message: `Failed to load history: ${err.message || err}`,
          date: new Date(),
          code: "",
          statusText: "Warning",
          statusState: "Warning"
        }]);
        oHistory.setProperty("/billingId", ""); // ✅ NEU: damit nix “altes” bleibt
      } finally {
        oHistory.setProperty("/busy", false);
      }
    },



    buildHistoryMessage: function (x) {
      const sText = x?.Text || "";
      const sType = x?.Type || "";
      const sUser = x?.User || "";

      if (sText && sText.length > 0) {
        return sText;
      }
      return [sType, sUser].filter(Boolean).join(" - ");
    },

    mapHistoryStatus: function (sDocState, sLogType /* ccMT_* */, sCode, sMsg) {
      switch (sLogType) {
        case "ccMT_Success":
          return { text: "Success", state: "Success" };

        case "ccMT_Info":
          return { text: "Information", state: "Information" };

        case "ccMT_Warning":
          return { text: "Warning", state: "Warning" };

        case "ccMT_Error":
          return { text: "Error", state: "Error" };

        case "ccMT_Update":
          return { text: "Information", state: "Information" };

        default:
          return { text: "Information", state: "Information" };
      }
    },

    formatHistoryMeta: function (dDate, sCode) {
      if (!dDate) return sCode || "";

      const oFmt = sap.ui.core.format.DateFormat.getDateTimeInstance({
        pattern: "dd.MM.yy HH:mm:ss"
      });

      const sD = oFmt.format(dDate instanceof Date ? dDate : new Date(dDate));
      const sC = (sCode || "").trim();

      return sC ? `${sD} | ${sC}` : sD;
    }
  };
});
