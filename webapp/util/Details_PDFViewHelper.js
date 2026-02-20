sap.ui.define([
  "sap/ui/core/UIComponent"
], function (UIComponent) {
  "use strict";

  return {
    // ==========================================================
    // PDF: Source vorbereiten (URL oder Base64 -> ObjectURL)
    // ==========================================================
    preparePdfSourceFromInvoice: async function (oController, oInvoice) {
      const oModel = oController.getOwnerComponent().getModel("backend");
      if (!oModel) return;

      const aBlobs = oInvoice?.MetaData?.Blobs || [];

      const isPdf = (b) =>
        b?.MimeType === "application/pdf" || ((b?.FileName || "").toLowerCase().endsWith(".pdf"));

      const isImg = (b) => {
        const fn = (b?.FileName || "").toLowerCase();
        return (b?.MimeType || "").startsWith("image/") ||
          fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg");
      };

      const aItems = [];

      // ✅ filter vorher, dann async-fähig iterieren
      const aRelevant = aBlobs.filter(b => isPdf(b) || isImg(b));

      for (const b of aRelevant) {
        const bIsPdf = isPdf(b);
        const sFileName = b.FileName || b.Name || (bIsPdf ? "PDF" : "Image");
        const sLink = b.Link || "";

        if (bIsPdf) {
          const aViewBlobs = Array.isArray(b?.ViewBlobs) ? b.ViewBlobs : [];

          if (aViewBlobs.length > 0) {
            aViewBlobs.forEach((vb, idx) => {
              aItems.push({
                sortId: b.SortId,
                id: `${b.Id || sFileName}__p${idx + 1}`,
                fileName: `${sFileName} (p.${idx + 1})`,
                mimeType: b.MimeType || "",
                fileLink: sLink,
                previewLink: vb?.Link || "",
                kind: "pdf",
                icon: "sap-icon://pdf-attachment",
                openText: "Open PDF",
                pageIndex: idx + 1
              });
            });
          } else {
            // ✅ hier darfst du jetzt await nutzen
            const oAuth = oController.getOwnerComponent().getModel("auth");
            const sAuthHeader =
              ((oAuth?.getProperty("/tokenType") || "Bearer").trim() + " " + (oAuth?.getProperty("/token") || "").trim()).trim();

            const sDocId = oModel.getProperty("/CurrentInvoice/Id"); 
            const sUrl = `https://test.app.clarc.com/application/api/v1/documenthub/document(${encodeURIComponent(sDocId)})/generateviewblobs`;

            const oResp = await fetch(sUrl, {
              method: "POST",
              credentials: "include",
              headers: { 
                "Content-Type": "application/json",
                "Authorization": sAuthHeader,
               },
              body: JSON.stringify({
                Limit: 0
              })
            });

            const sText = await oResp.text();
            if (!oResp.ok) {
              sap.m.MessageBox.error(`Generating of View Bolobs failed (${oResp.status}): ${sText}`);
              return;
            }
            const oJson = JSON.parse(sText);

            const aViewBlobs = (oJson?.Blobs?.[0]?.ViewBlobs) || [];

            aViewBlobs.forEach((vb, idx) => {
              aItems.push({
                sortId: b.SortId,
                id: `${b.Id || sFileName}__p${idx + 1}`,
                fileName: `${sFileName} (p.${idx + 1})`,
                mimeType: b.MimeType || "",
                fileLink: sLink,
                previewLink: vb?.Link || "",
                kind: "pdf",
                icon: "sap-icon://pdf-attachment",
                openText: "Open PDF",
                pageIndex: idx + 1
              });
            });

            // // optional: wenn du danach ViewBlobs neu laden willst, hier machen.

            // aItems.push({
            //   sortId: b.SortId,
            //   id: b.Id,
            //   fileName: sFileName,
            //   mimeType: b.MimeType || "",
            //   fileLink: sLink,
            //   previewLink: "",
            //   kind: "pdf",
            //   icon: "sap-icon://pdf-attachment",
            //   openText: "Open PDF"
            // });
          }

          continue;
        }

        // Image bleibt 1:1
        aItems.push({
          sortId: b.SortId,
          id: b.Id,
          fileName: sFileName,
          mimeType: b.MimeType || "",
          fileLink: sLink,
          previewLink: sLink,
          kind: "image",
          icon: "sap-icon://attachment-photo",
          openText: "Open Image"
        });
      }

      oModel.setProperty("/CurrentInvoice/BlobItems", aItems);

      // Selektion beibehalten (wie bei dir)
      const iOldIndex = oModel.getProperty("/CurrentInvoice/SelectedBlobIndex");
      const sOldId = (Number.isInteger(iOldIndex) && aItems[iOldIndex]) ? aItems[iOldIndex].id : null;

      let iNewIndex = 0;
      if (sOldId) {
        const idx = aItems.findIndex(x => x.id === sOldId);
        if (idx >= 0) iNewIndex = idx;
      } else if (Number.isInteger(iOldIndex) && iOldIndex >= 0 && iOldIndex < aItems.length) {
        iNewIndex = iOldIndex;
      }

      oModel.setProperty("/CurrentInvoice/SelectedBlobIndex", iNewIndex);

      const oSel = aItems[iNewIndex] || null;

      oModel.setProperty("/CurrentInvoice/SelectedFileKind", oSel?.kind || "");
      oModel.setProperty("/CurrentInvoice/SelectedFileSource", oSel?.fileLink || "");
      oModel.setProperty("/CurrentInvoice/PdfSource", oSel?.kind === "pdf" ? (oSel?.fileLink || "") : "");
    },




    // PDF: Popup öffnen (wie UI5 Sample)
    onPdfPress: function (oController) {
      const oModel = oController.getOwnerComponent().getModel("backend");
      const sSource = oModel.getProperty("/CurrentInvoice/PdfSource");

      if (!sSource) {
        console.warn("Keine PDF-Quelle vorhanden (/CurrentInvoice/PdfSource ist leer).");
        return;
      }

      // Controller besitzt den Viewer (wird in onInit erzeugt)
      oController._oPdfViewer.setSource(sSource);
      oController._oPdfViewer.setTitle("Invoice PDF");
      oController._oPdfViewer.open();
    },

    onFilePress: function (oController) {
      const oModel = oController.getOwnerComponent().getModel("backend");
      const sKind = oModel.getProperty("/CurrentInvoice/SelectedFileKind");
      const sSource = oModel.getProperty("/CurrentInvoice/SelectedFileSource");

      if (!sSource) {
        console.warn("Keine Quelle vorhanden.");
        return;
      }

      if (sKind === "pdf") {
        // wie bisher
        oController._oPdfViewer.setSource(sSource);
        oController._oPdfViewer.setTitle("Invoice PDF");
        oController._oPdfViewer.open();
        return;
      }

      if (sKind === "image") {
        // ✅ Bild-Popup (lazy, einmalig)
        if (!oController._oImageDialog) {
          oController._oImageDialog = new sap.m.Dialog({
            title: "Image",
            stretch: true,
            content: [
              new sap.m.Image({ width: "100%", densityAware: false })
            ],
            beginButton: new sap.m.Button({
              text: "Close",
              press: function () { oController._oImageDialog.close(); }
            })
          });
          oController.getView().addDependent(oController._oImageDialog);
        }

        const oImg = oController._oImageDialog.getContent()[0];
        oImg.setSrc(sSource);

        oController._oImageDialog.open();
        return;
      }

      // Fallback: unbekannt -> nur neues Tab öffnen
      window.open(sSource, "_blank");
    },


    onBlobPageChanged: function (oController, oEvent) {
      const iIndex = oEvent.getParameter("activePages")[0];
      const oModel = oController.getOwnerComponent().getModel("backend");

      const aItems = oModel.getProperty("/CurrentInvoice/BlobItems") || [];
      const oItem = aItems[iIndex];

      oModel.setProperty("/CurrentInvoice/SelectedBlobIndex", iIndex);
      oModel.setProperty("/CurrentInvoice/SelectedFileKind", oItem?.kind || "");
      oModel.setProperty("/CurrentInvoice/SelectedFileSource", oItem?.fileLink || "");

      // Keep backward compatibility (falls noch irgendwo PdfSource genutzt wird)
      oModel.setProperty("/CurrentInvoice/PdfSource", oItem?.kind === "pdf" ? (oItem?.fileLink || "") : "");
    },


    onClose: function (oController) {
      const oRouter = UIComponent.getRouterFor(oController);
      oRouter.navTo("RouteView1", {}, true);

      const oMainViewModel = oController.getView().getModel("mainView");
      if (oMainViewModel) {
        oMainViewModel.setProperty("/layout", "OneColumn");
      }
    }
  };
});
