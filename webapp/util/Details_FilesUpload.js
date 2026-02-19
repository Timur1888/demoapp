sap.ui.define([], function () {
  "use strict";

  return {
    // ---------------------------------------------------------------------------------------------------
    // UploadSet (Invoice) - sofort speichern bei Drop/Select
    // ---------------------------------------------------------------------------------------------------
    onInvoiceItemAdded: async function (oController, oEvent) {
      const oItem = oEvent.getParameter("item"); // sap.m.upload.UploadSetItem
      if (!oItem) { return; }

      try {
        await this.persistUploadSetItems(oController, [oItem], "ccBT_Invoice", "uploadSetInvoice");
      } catch (e) {
        console.error("Invoice afterItemAdded Fehler:", e);
      }
    },

    // ---------------------------------------------------------------------------------------------------
    // UploadSet (Attachments) - sofort speichern bei Drop/Select
    // ---------------------------------------------------------------------------------------------------
    onAttachmentItemAdded: async function (oController, oEvent) {
      const oItem = oEvent.getParameter("item");
      if (!oItem) { return; }

      try {
        await this.persistUploadSetItems(oController, [oItem], "ccBT_Attachment", "uploadSetAttachments");
      } catch (e) {
        console.error("Attachment afterItemAdded Fehler:", e);
      }
    },

    postAppendBlobs: async function (oController, aBlobPayload) {
      const sDocId = this.getCurrentDocumentId(oController);
      if (!sDocId) throw new Error("Keine CurrentInvoice/Id gefunden.");

      const oAuth = oController.getOwnerComponent().getModel("auth");
      const sType = oAuth?.getProperty("/tokenType");
      const sTok  = oAuth?.getProperty("/token");

      if (!sType || !sTok) {
        throw new Error("Kein Token im auth-Model gefunden (Login/Token speichern prüfen).");
      }

      const sUrl =
        `https://test.app.clarc.com:443/application/api/v1/documenthub/document(${encodeURIComponent(sDocId)})/appendblobs`;

      const r = await fetch(sUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `${sType} ${sTok}`
        },
        body: JSON.stringify({ Blobs: aBlobPayload })
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`appendblobs failed (${r.status}): ${t}`);
      }

      return await r.json();
    },

    // ---------------------------------------------------------------------------------------------------
    // Delete über UploadSet (nachdem User "Remove" bestätigt hat)
    // ---------------------------------------------------------------------------------------------------
    onAfterInvoiceItemRemoved: async function (oController, oEvent) {
      await this.handleUploadSetItemRemoved(oController, oEvent, "uploadSetInvoice");
      oController._loadHistoryLogs(true);
    },

    onAfterAttachmentItemRemoved: async function (oController, oEvent) {
      await this.handleUploadSetItemRemoved(oController, oEvent, "uploadSetAttachments");
      oController._loadHistoryLogs(true);
    },

    handleUploadSetItemRemoved: async function (oController, oEvent, sUploadSetId) {
      const oUS = oController.byId(sUploadSetId);
      const oItem = oEvent.getParameter("item");
      if (!oItem) { return; }

      // Fall 1: Item kommt aus Backend-Binding (persistiert)
      const oCtx = oItem.getBindingContext && oItem.getBindingContext("backend");
      const oBlob = oCtx && oCtx.getObject ? oCtx.getObject() : null;
      const sBlobId = oBlob?.Id;

      // Fall 2: Pending item (noch nicht persistiert)
      if (!sBlobId) {
        try {
          if (oUS && oUS.removeIncompleteItem) {
            oUS.removeIncompleteItem(oItem);
          }
        } catch (e) { /* ignore */ }
        return;
      }

      try {
        oController.getView().setBusy(true);

        const oResp = await this.postRemoveBlobs(oController, [sBlobId]);

        const oBackendModel = oController.getOwnerComponent().getModel("backend");
        if (oResp?.value) {
          oBackendModel.setProperty("/CurrentInvoice/MetaData/Blobs", oResp.value);
        } else {
          const a = oBackendModel.getProperty("/CurrentInvoice/MetaData/Blobs") || [];
          oBackendModel.setProperty("/CurrentInvoice/MetaData/Blobs", a.filter(b => b?.Id !== sBlobId));
        }

        this.rebuildLists(oController);
      } catch (e) {
        console.error("UploadSet Remove Fehler:", e);
      } finally {
        oController.getView().setBusy(false);
      }
    },

    rebuildLists: function (oController) {
      const oModel = oController.getOwnerComponent().getModel("backend");
      const aBlobs = oModel.getProperty("/CurrentInvoice/MetaData/Blobs") || [];
      oModel.setProperty("/CurrentInvoice/InvoiceBlobs", aBlobs.filter(b => b?.Type === "ccBT_Invoice"));
      oModel.setProperty("/CurrentInvoice/AttachmentBlobs", aBlobs.filter(b => b?.Type !== "ccBT_Invoice"));

      // bleibt im Controller (deine UI-Refresh-Logik)
      if (typeof oController._refreshPanel === "function") {
        oController._refreshPanel();
      }
    },

    getCurrentDocumentId: function (oController) {
      const oModel = oController.getOwnerComponent().getModel("backend");
      return oModel.getProperty("/CurrentInvoice/Id") || "";
    },

    fileToBase64: function (oFile) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = String(r.result || "");
          const base64 = s.includes("base64,") ? s.split("base64,")[1] : s;
          resolve(base64);
        };
        r.onerror = reject;
        r.readAsDataURL(oFile);
      });
    },

    onBrowseInvoice: function (oController) {
      var oUploader = oController.byId("invoiceUploader");
      if (!oUploader) {
        console.error("invoiceUploader nicht gefunden");
        return;
      }

      if (oUploader.openFileDialog) {
        oUploader.openFileDialog();
      } else {
        setTimeout(function () {
          var oDomRef = oUploader.getDomRef();
          if (!oDomRef) { return; }

          var oFileInput = oDomRef.querySelector("input[type='file']");
          if (oFileInput) {
            oFileInput.click();
          }
        }, 0);
      }
    },

    // ---------------------------------------------------------------------------------------------------
    // Gemeinsame Persistenz für UploadSet-Items (Base64 -> appendblobs)
    // ---------------------------------------------------------------------------------------------------
    persistUploadSetItems: async function (oController, aItems, sBlobType, sUploadSetId) {
      if (!Array.isArray(aItems) || !aItems.length) { return; }

      const oUS = oController.byId(sUploadSetId);
      const oBackendModel = oController.getOwnerComponent().getModel("backend");

      try {
        oController.getView().setBusy(true);

        const aPayload = [];

        for (const oItem of aItems) {
          const oCtx = oItem.getBindingContext && oItem.getBindingContext("backend");
          const oObj = oCtx && oCtx.getObject ? oCtx.getObject() : null;

          // bereits persistiert → skip
          if (oObj?.Id && (oObj.FileName || oObj.MimeType)) {
            continue;
          }

          const oFile =
            (oItem.getFileObject && oItem.getFileObject()) ||
            oItem._oFileObject;

          if (!oFile) {
            continue;
          }

          const sB64 = await this.fileToBase64(oFile);

          aPayload.push({
            FileName: oFile.name,
            MimeType: oFile.type || "application/octet-stream",
            Name: oFile.name,
            SortId: 0,
            Type: sBlobType,
            Upload: {
              GenerateViewBlob: "ccVG_Instant",
              BlobId: "",
              BlobData: sB64
            }
          });
        }

        if (!aPayload.length) { return; }

        const oResp = await this.postAppendBlobs(oController, aPayload);

        if (oResp?.value) {
          const aOld = oBackendModel.getProperty("/CurrentInvoice/MetaData/Blobs") || [];
          const aNew = this.mergeBlobsKeepOrder(aOld, oResp.value);

          oBackendModel.setProperty("/CurrentInvoice/MetaData/Blobs", aNew);
          this.rebuildLists(oController);
          oController._loadHistoryLogs(true);
        }

        // Pending Items entfernen
        if (oUS?.removeIncompleteItem) {
          aItems.forEach(oItem => {
            try { oUS.removeIncompleteItem(oItem); } catch (e) { /* ignore */ }
          });
        }

      } finally {
        oController.getView().setBusy(false);
      }

      this.wireUploadSetItemPress(oController, "uploadSetInvoice");
      this.wireUploadSetItemPress(oController, "uploadSetAttachments");
    },

    postRemoveBlobs: async function (oController, aBlobIds) {
      const sDocId = this.getCurrentDocumentId(oController);
      if (!sDocId) throw new Error("Keine CurrentInvoice/Id gefunden.");

      const oAuth = oController.getOwnerComponent().getModel("auth");
      const sType = oAuth?.getProperty("/tokenType");
      const sTok  = oAuth?.getProperty("/token");
      if (!sType || !sTok) throw new Error("Kein Token im auth-Model gefunden.");

      const sUrl =
        `https://test.app.clarc.com:443/application/api/v1/documenthub/document(${encodeURIComponent(sDocId)})/removeblobs`;

      const r = await fetch(sUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `${sType} ${sTok}`
        },
        body: JSON.stringify({
          Blobs: aBlobIds
        })
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`removeblobs failed (${r.status}): ${t}`);
      }
      return await r.json();
    },

    mergeBlobsKeepOrder: function (aOld, aFromResp) {
      const oldArr  = Array.isArray(aOld) ? aOld : [];
      const respArr = Array.isArray(aFromResp) ? aFromResp : [];

      const mResp = new Map(respArr.map(b => [b?.Id, b]));

      const aMerged = [];
      const seen = new Set();

      for (const bOld of oldArr) {
        const id = bOld?.Id;
        if (!id) continue;

        aMerged.push(mResp.get(id) || bOld);
        seen.add(id);
      }

      for (const bNew of respArr) {
        const id = bNew?.Id;
        if (!id) continue;
        if (!seen.has(id)) {
          aMerged.push(bNew);
          seen.add(id);
        }
      }

      return aMerged;
    },

    wireUploadSetItemPress: function (oController, sUploadSetId) {
      const oUS = oController.byId(sUploadSetId);
      if (!oUS) { return; }

      oUS.getItems().forEach((oUSItem) => {
        const oListItem = oUSItem.getListItem && oUSItem.getListItem();
        if (!oListItem) { return; }

        if (oListItem.data("__wiredPress")) { return; }
        oListItem.data("__wiredPress", true);

        if (oListItem.setType) {
          oListItem.setType("Active");
        }

        oListItem.attachPress(() => {
          this.openUploadSetItem(oController, oUSItem);
        });
      });
    },

    openUploadSetItem: function (oController, oUSItem) {
      const oCtx = oUSItem.getBindingContext && oUSItem.getBindingContext("backend");
      const oObj = oCtx && oCtx.getObject ? oCtx.getObject() : null;

      const sUrl  = oObj?.DownloadUrl || oObj?.Link || oUSItem.getUrl?.() || "";
      const sName = oObj?.FileName || oUSItem.getFileName?.() || "File";
      const sMime = oObj?.MimeType || oUSItem.getMediaType?.() || "";

      if (!sUrl) {
        console.warn("Keine URL zum Öffnen gefunden");
        return;
      }

      const bIsPdf = sMime === "application/pdf" || sName.toLowerCase().endsWith(".pdf");
      const bIsImg = (sMime || "").startsWith("image/") || /\.(png|jpe?g)$/i.test(sName);

      if (bIsPdf) {
        oController._oPdfViewer.setSource(sUrl);
        oController._oPdfViewer.setTitle(sName);
        oController._oPdfViewer.open();
        return;
      }

      if (bIsImg) {
        if (!oController._oImageDialog) {
          oController._oImageDialog = new sap.m.Dialog({
            title: "Image",
            stretch: true,
            content: [new sap.m.Image({ width: "100%", densityAware: false })],
            beginButton: new sap.m.Button({
              text: "Close",
              press: () => oController._oImageDialog.close()
            })
          });
          oController.getView().addDependent(oController._oImageDialog);
        }

        oController._oImageDialog.setTitle(sName);
        oController._oImageDialog.getContent()[0].setSrc(sUrl);
        oController._oImageDialog.open();
        return;
      }

      window.open(sUrl, "_blank", "noopener");
    }
  };
});
