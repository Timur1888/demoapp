sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/UIComponent",
  "sap/ui/core/Fragment",
  "sap/ui/model/json/JSONModel",
  "sap/m/PDFViewer",
  "sap/m/MessageToast",
  "demo/app/demoapp/util/Details_PDFViewHelper",
  "demo/app/demoapp/util/Details_HistoryHelper",
  "demo/app/demoapp/util/Details_FilesUpload"
], (Controller, UIComponent, Fragment, JSONModel, PDFViewer, MessageToast, Details_PDFViewHelper, Details_HistoryHelper, Details_FilesUpload) => {

  "use strict";

  return Controller.extend("demo.app.demoapp.controller.Details", {

    onInit() {
      if (!this.getView().getModel("history")) {
        this.getView().setModel(new sap.ui.model.json.JSONModel({
          busy: false,
          logs: [],
          lastDocId: "",
          billingId: "",
          historyDocId: "",
        }), "history");
      }

      var oSendModel = new sap.ui.model.json.JSONModel({
        transferFormat: "",
        deliveryMethod: "",
        recipient: "",
        cc: "",
        bcc: "",
        canSend: true
      });
      this.getView().setModel(oSendModel, "send");

      // ✅ Template-Model: pro Rechnung
      var oTemplateModel = new JSONModel({
        currentInvoiceKey: "",     // Rechnungsnummer (Key)
        invoices: {},              // Map: { [invoiceKey]: {subject, body, selectedLanguageKey} }
        languages: [
          { key: "de", name: "German" },
          { key: "en", name: "English" },
          { key: "fr", name: "French" },
          { key: "es", name: "Spanish" }
        ]
      });
      this.getView().setModel(oTemplateModel, "template");

      //das Model, das das JSON des ganzen Dokuments zwischenspeichert.
      this.getView().setModel(new sap.ui.model.json.JSONModel({
        docId: "",
        doc: null,
        fetchedAt: null,
        canSave: false  //das Wert für Save Button. Keine Änderung -> Button disablen -> nichts speichern
      }), "docCache");

      this._pMsgTemplateDialog = null;
      this._oTemplateBackup = null; // Backup nur für aktuelle Rechnung

      // ✅ PDFViewer wie im UI5 Sample (einmalig)
      this._oPdfViewer = new PDFViewer({
        isTrustedSource: true,
        showDownloadButton: true
      });
      this.getView().addDependent(this._oPdfViewer);

      const oRouter = UIComponent.getRouterFor(this);
      oRouter.getRoute("DetailsRoute").attachPatternMatched(this._onRouteMatched, this);

      // immer unten lassen, damit werden die Items für die Bilder klickbar
      this.byId("uploadSetInvoice")?.addEventDelegate({
        onAfterRendering: () => this._wireUploadSetItemPress("uploadSetInvoice")
      });
      this.byId("uploadSetAttachments")?.addEventDelegate({
        onAfterRendering: () => this._wireUploadSetItemPress("uploadSetAttachments")
      });
    },

    onValueChange: function () {
      this.getView().getModel("docCache").setProperty("/canSave", true);
    },

        // ------------------------------- Edit Templates -------------------------------
    _ensureTemplateForInvoice: function (sInvoiceKey) {
      var oModel = this.getView().getModel("template");
      sInvoiceKey = String(sInvoiceKey || "").trim();   // ✅ WICHTIG
      if (!oModel || !sInvoiceKey) { return; }

      oModel.setProperty("/currentInvoiceKey", sInvoiceKey);

      var sPath = "/invoices/" + sInvoiceKey;
      var oExisting = oModel.getProperty(sPath);

      if (!oExisting) {
        var oBackend = this.getOwnerComponent().getModel("backend");
        oModel.setProperty(sPath, {
          subject: oBackend.getProperty("/CurrentInvoice/MetaData/Object/Data/Subject"),
          body: oBackend.getProperty("/CurrentInvoice/MetaData/Object/Data/AdditionalInformation"),
          selectedLanguageKey: "en"
        });
      }
    },

        _getCurrentTemplatePath: function () {
      var oModel = this.getView().getModel("template");
      var sKey = oModel?.getProperty("/currentInvoiceKey");
      return sKey ? ("/invoices/" + sKey) : null;
    },
    _bindTemplateContexts: function () {
      var sPath = this._getCurrentTemplatePath();
      if (!sPath) { return; }

      // ✅ Panel-Templates-Bereich (VBox) an aktuelle Rechnung binden
      // Voraussetzung: Im XML dem Templates-VBox eine ID geben: id="tplBox"
      var oTplBox = this.byId("tplBox");
      if (oTplBox) {
        oTplBox.bindElement({ path: sPath, model: "template" });
      }

      // ✅ Dialog (wenn schon geladen) auch auf aktuelle Rechnung binden
      var oDialog = this.byId("msgTemplateDialog");
      if (oDialog) {
        oDialog.bindElement({ path: sPath, model: "template" });
      }
    },
    

    onOpenTemplateDialog: function () {
      var oView = this.getView();
      var oModel = oView.getModel("template");
      var sPath = this._getCurrentTemplatePath();
      if (!oModel || !sPath) { return; }

      // ✅ Backup für Cancel (nur aktuelle Rechnung!)
      this._oTemplateBackup = {
        subject: oModel.getProperty(sPath + "/subject") || "",
        body: oModel.getProperty(sPath + "/body") || "",
        selectedLanguageKey: oModel.getProperty(sPath + "/selectedLanguageKey") || "en"
      };

      if (!this._pMsgTemplateDialog) {
        this._pMsgTemplateDialog = Fragment.load({
          id: oView.getId(),
          name: "demo.app.demoapp.view.fragments.MessageTemplateDialog",
          controller: this
        }).then(function (oDialog) {
          oView.addDependent(oDialog);
          return oDialog;
        });
      }

      this._pMsgTemplateDialog.then(function (oDialog) {
        // ✅ Dialog auf aktuelle Rechnung binden (relatives Binding im Fragment!)
        oDialog.bindElement({ path: sPath, model: "template" });
        oDialog.open();

        // ✅ Sprache in der Liste korrekt setzen (nach Rendering)
        setTimeout(function () {
          this._applyLanguageSelection();
        }.bind(this), 0);
      }.bind(this));
    },

    onTemplateDialogSave: function () {
      // Save = nichts extra (Binding ist live), nur schließen
      this.byId("msgTemplateDialog")?.close();

      // Backup aktualisieren (optional)
      var oModel = this.getView().getModel("template");
      var sPath = this._getCurrentTemplatePath();
      if (oModel && sPath) {
        this._oTemplateBackup = {
          subject: oModel.getProperty(sPath + "/subject") || "",
          body: oModel.getProperty(sPath + "/body") || "",
          selectedLanguageKey: oModel.getProperty(sPath + "/selectedLanguageKey") || "en"
        };
      }
      this.onValueChange(); //Save Button aktivieren
      // Panel-Templates ggf. direkt aktualisieren
      this._bindTemplateContexts();
    },


    onTemplateDialogCancel: function () {
      var oModel = this.getView().getModel("template");
      var sPath = this._getCurrentTemplatePath();
      if (!oModel || !sPath) { return; }

      if (this._oTemplateBackup) {
        oModel.setProperty(sPath + "/subject", this._oTemplateBackup.subject || "");
        oModel.setProperty(sPath + "/body", this._oTemplateBackup.body || "");
        oModel.setProperty(sPath + "/selectedLanguageKey", this._oTemplateBackup.selectedLanguageKey || "en");
      }

      this._applyLanguageSelection();
      this.byId("msgTemplateDialog")?.close();

      // Panel wieder auf gespeicherten Stand bringen
      this._bindTemplateContexts();
    },

    onLanguageSelectionChange: function (oEvent) {
      var oItem = oEvent.getParameter("listItem");
      if (!oItem) { return; }

      var sKey = oItem.getBindingContext("template")?.getProperty("key");
      if (!sKey) { return; }

      var oModel = this.getView().getModel("template");
      var sPath = this._getCurrentTemplatePath();
      if (!oModel || !sPath) { return; }

      oModel.setProperty(sPath + "/selectedLanguageKey", sKey);
    },

    _applyLanguageSelection: function () {
      var oList = this.byId("lstLanguages");
      var oModel = this.getView().getModel("template");
      var sPath = this._getCurrentTemplatePath();
      if (!oList || !oModel || !sPath) { return; }

      var sKey = oModel.getProperty(sPath + "/selectedLanguageKey") || "en";
      var aItems = oList.getItems() || [];

      var oMatch = aItems.find(function (oItem) {
        return oItem.getBindingContext("template")?.getProperty("key") === sKey;
      }) || aItems[0];

      oList.removeSelections(true);
      if (oMatch) {
        oList.setSelectedItem(oMatch, true);
      }
    },



    // ======================================================================
    // Formatter (Panel-Anzeige)
    // ======================================================================

    formatTemplateSubject: function (sSubject) {
      if (!sSubject || !sSubject.trim()) { return ""; }
      return "<em>" + this._escapeHtml(sSubject.trim()) + "</em>";
    },

    formatTemplateBody: function (sBody) {
      if (!sBody || !sBody.trim()) { return ""; }
      var s = this._escapeHtml(sBody.trim());
      s = s.replace(/\r?\n/g, "<br/>");
      return "<em>" + s + "</em>";
    },

    _escapeHtml: function (s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

//------------------------------------------------------------------------------------------------------------------------------------------------------------------
        // ==========================================================
        // Panel komplett neu wenn User eine Rechnung selektiert
        // ==========================================================
        _resetDetailsUI: function () {
          // Tab immer auf Overview
          this.byId("itbDetails")?.setSelectedKey("overview");

          // Scroll nach oben (IDs wie besprochen)
          this.byId("scOverview")?.scrollTo(0, 0, 0);
          this.byId("scHistory")?.scrollTo(0, 0, 0);
          this.byId("detailsPage")?.scrollTo(0, 0, 0);
        },
        _onRouteMatched: function (oEvent) {
            const oMain = this.getView().getModel("mainView");
            const oRouter = sap.ui.core.UIComponent.getRouterFor(this);

            // Reload / direkter Einstieg: Details NICHT öffnen, sondern zurück zur Liste
            if (oMain && !oMain.getProperty("/openDetailsOnMatch")) {
              oMain.setProperty("/layout", "OneColumn");
              oRouter.navTo("RouteView1", {}, true);
              return;
            }

            // Normale Navigation aus View1: Details darf aufgehen
            if (oMain) {
              oMain.setProperty("/layout", "TwoColumnsBeginExpanded");
              oMain.setProperty("/openDetailsOnMatch", false);
            }

            requestAnimationFrame(() => this._resetDetailsUI());
            
            const oModel = this.getOwnerComponent().getModel("backend");
            if (!oModel) {
                console.error("Model 'backend' nicht gefunden");
                return;
            }
            this.getView().getModel("docCache").setProperty("/canSave", false);
            const sInvoiceId =  String(oEvent.getParameter("arguments").invoiceId).trim();

            const aInvoices = oModel.getProperty("/value") || [];
            const sWanted = String(sInvoiceId || "").trim();

            let oInvoice = aInvoices.find(function (o) {
                const v = o?.MetaData?.Object?.Data?.Basics?.Number?.Value;
                return String(v ?? "").trim() === sWanted;
            });

            if (!oInvoice) {
                oInvoice = aInvoices.find(function (o) {
                    return String(o?.Id ?? "").trim() === sWanted;
                });
            }

            if (!oInvoice) {
                console.warn("Keine Rechnung mit ID", sInvoiceId, "gefunden");
                return;
            }

            oModel.setProperty("/CurrentInvoice", oInvoice);

            this.getView().bindElement({
                path: "/CurrentInvoice",
                model: "backend"
            });

            // Recipient name aus Backend holen
            var oSend = this.getView().getModel("send");
            var oBackend = this.getOwnerComponent().getModel("backend");
            oSend.setProperty("/recipient", oBackend.getProperty("/CurrentInvoice/MetaData/Object/Data/Basics/Recipient/Email/0/Address"));
            //Transfer Format
            const sTransFormat = oBackend.getProperty("/CurrentInvoice/MetaData/Object/Data/Basics/TransferFormat"); 
            var mMap = { "ccBF_PDF": "pdf", "ccBF_XInvoice": "xrechnung", "ccBF_FacturX": "zugferd", "ccBF_Paper": "paper" };// oder Mapping, wenn Backend andere Codes liefert:
            oSend.setProperty("/transferFormat", mMap[sTransFormat] || "pdf");
            this._sOldTransferFormat = this.byId("transF").getSelectedItem()?.getText(); //fürs Save den Wert merken
            //Delivery Method
            const sDelivMethod = oBackend.getProperty("/CurrentInvoice/MetaData/Object/Data/Basics/DeliveryMethod");
            mMap = {"ccDM_Email": "email", "ccDM_PostalService": "post", "ccDM_EGatewayProvider": "eGateWay"};
            oSend.setProperty("/deliveryMethod", mMap[sDelivMethod] || "email")
            this.sOldDeliveryMethod = this.byId("delMeth").getSelectedItem()?.getText();
            oSend.setProperty("/canSend", true); //Send-Button klickbar machen


            //Template an die Rechnung binden
      if (sInvoiceId) {
        this._ensureTemplateForInvoice(sInvoiceId);
        this._bindTemplateContexts(); // Panel + Dialog auf diese Rechnung binden
      } else {
        console.warn("Keine Rechnung mit ID", sInvoiceId, "gefunden – Template bleibt global.");
      }

      // ✅ Overview/Preview aktualisieren
      this._refreshPanel();

      // ✅ HISTORY: Sofort laden beim Öffnen/Wechseln
      this._loadHistoryLogs(true);

      // ✅ UploadSets/Listen neu aufbauen
      this._rebuildLists();
    },

        // ==========================================================
        // Refresht NUR Overview (Preview/Carousel) zur Laufzeit
        // ==========================================================
        _refreshPanel: function () {
            const oBackend = this.getOwnerComponent().getModel("backend");
            const oInvoice = oBackend?.getProperty("/CurrentInvoice");
            if (!oInvoice) { return; }

            // OVERVIEW: Preview / Carousel aktualisieren
            this._preparePdfSourceFromInvoice(oInvoice);

            const oCarousel = this.byId("blobCarousel");
            if (oCarousel) {
                const oBind = oCarousel.getBinding("pages");
                if (oBind && oBind.refresh) {
                    oBind.refresh(true);
                }
                oCarousel.invalidate();
            }
        },

        
        // HISTORY: Tab Select -> sicherstellen, dass Logs da sind, man braucht das dafür, dass die Logs aktualisiert werden, selbst wenn Panel nicht neu geöffnet wird
        onIconTabSelect: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            if (sKey === "history") {
                // ✅ Beim Klick auf History nochmal sicher laden (cached -> kein Doppelcall)
                this._loadHistoryLogs();
            }
            // Wenn du im Helper noch andere Logik hast (z.B. scroll), kannst du ihn trotzdem callen:
            // return Details_HistoryHelper.onIconTabSelect(this, oEvent);
        },

        _loadHistoryLogs: function (bForce) {
        return Details_HistoryHelper.loadHistoryLogs(this, !!bForce);
        },

        _mapHistoryStatus: function (sDocState, sLogType, sCode, sMsg) {
            return Details_HistoryHelper.mapHistoryStatus(sDocState, sLogType, sCode, sMsg);
        },

        formatHistoryMeta: function (dDate, sCode) {
            return Details_HistoryHelper.formatHistoryMeta(dDate, sCode);
        },

        // ------------------------------- PDF anzeigen -------------------------------
        _preparePdfSourceFromInvoice: function (oInvoice) {
            return Details_PDFViewHelper.preparePdfSourceFromInvoice(this, oInvoice);
        },

        onPdfPress: function () {
            return Details_PDFViewHelper.onPdfPress(this);
        },

        onFilePress: function () {
            return Details_PDFViewHelper.onFilePress(this);
        },

        onBlobPageChanged: function (oEvent) {
            return Details_PDFViewHelper.onBlobPageChanged(this, oEvent);
        },

      onClose: function () {
        const bCanSave = this.getView().getModel("docCache").getProperty("/canSave");
        return Details_PDFViewHelper.onClose(this, bCanSave);
      },

        // ------------------------------- Uploader -------------------------------
        onInvoiceItemAdded: function (oEvent) {
            return Details_FilesUpload.onInvoiceItemAdded(this, oEvent);
        },

        onAttachmentItemAdded: function (oEvent) {
            return Details_FilesUpload.onAttachmentItemAdded(this, oEvent);
        },

        onAfterInvoiceItemRemoved: function (oEvent) {
            return Details_FilesUpload.onAfterInvoiceItemRemoved(this, oEvent);
        },

        onAfterAttachmentItemRemoved: function (oEvent) {
            return Details_FilesUpload.onAfterAttachmentItemRemoved(this, oEvent);
        },

        _rebuildLists: function () {
            return Details_FilesUpload.rebuildLists(this);
        },

        _getCurrentDocumentId: function () {
            return Details_FilesUpload.getCurrentDocumentId(this);
        },

        onBrowseInvoice: function () {
            return Details_FilesUpload.onBrowseInvoice(this);
        },

        _wireUploadSetItemPress: function (sUploadSetId) {
            return Details_FilesUpload.wireUploadSetItemPress(this, sUploadSetId);
        },
//---------------------------------------------------------------------------------------------Senden------------------------------------------------------------------------------------------------------
onSendInvoice: async function () {
  const oView    = this.getView();
  const oSend    = oView.getModel("send");
  const oAuth    = this.getOwnerComponent().getModel("auth");
  const oHistory = oView.getModel("history");
  const oModel   = this.getOwnerComponent().getModel("backend");
  const oTemplate = oView.getModel("template");

    // Button sofort ausgrauen
  oSend.setProperty("/canSend", false);
  // ---------------------------
  // Helper: String → [{Address}]
  // ---------------------------
  const fnToAddressArray = (s) =>
    (s || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
      .map(addr => ({ Address: addr }));   // ✅ NUR Address

  // 1) Werte aus UI
  const sRecipient = (oSend?.getProperty("/recipient") || "").trim();
  const sCc        = (oSend?.getProperty("/cc") || "").trim();
  const sBcc       = (oSend?.getProperty("/bcc") || "").trim();

  if (!sRecipient) {
    sap.m.MessageBox.warning("Please enter a Receiver email.");
    return;
  }

  const sDocHubItemId = (oModel?.getProperty("/CurrentInvoice/Id") || "").trim();
  if (!sDocHubItemId) {
    sap.m.MessageBox.error("No document selected (DocHubItemId is empty).");
    return;
  }

  // BillingId aus history-Model
  let sBillingId = (oHistory?.getProperty("/billingId") || "").trim();
  if (!sBillingId && typeof this._loadHistoryLogs === "function") {
    await this._loadHistoryLogs(true);
    sBillingId = (oHistory?.getProperty("/billingId") || "").trim();
  }

  if (!sBillingId) {
    sap.m.MessageBox.error("Billing Id not found.");
    return;
  }

  // Token
  const sType = (oAuth?.getProperty("/tokenType") || "Bearer").trim();
  const sTok  = (oAuth?.getProperty("/token") || "").trim();
  if (!sTok) {
    sap.m.MessageBox.error("No auth token found.");
    return;
  }

  // ---------------------------
  // Payload (ohne Email/Value)
  // ---------------------------
  const oPayload = {
    DocHubItemId: sDocHubItemId,
    Recipients: fnToAddressArray(sRecipient), // ✅ nur Address
    Cc: fnToAddressArray(sCc),
    Bcc: fnToAddressArray(sBcc),
    Subject: oTemplate.getProperty("/invoices/" + oTemplate.getProperty("/currentInvoiceKey") + "/subject"),
    Body: oTemplate.getProperty("/invoices/" + oTemplate.getProperty("/currentInvoiceKey") + "/body") 
  };

  if (!oPayload.Recipients.length) {
    sap.m.MessageBox.error("At least one recipient is required.");
    return;
  }

  //Test
  const sUrl =
    `https://test.app.clarc.com:443/application/api/v1/bpm/billing(${encodeURIComponent(sBillingId)})/sendinvoice`;
  //cci001
  // const sUrl =
    // `https://cci001.app.clarc.com:443/application/api/v1/bpm/billing(${encodeURIComponent(sBillingId)})/sendinvoice`;
  try {
    oView.setBusy(true);

    const oResp = await fetch(sUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `${sType} ${sTok}`
      },
      body: JSON.stringify(oPayload)
    });

    const sText = await oResp.text();
    if (!oResp.ok) {
      sap.m.MessageBox.error(`Send failed (${oResp.status}): ${sText}`);
      return;
    }

    sap.m.MessageToast.show("Invoice sent successfully.");

    this.onSavePanel(true);

  } catch (e) {
    oSend.setProperty("/canSend", true);
    sap.m.MessageBox.error(`Send failed: ${e?.message || e}`);
  } finally {
    oView.setBusy(false);
  }
},

//----------------------------------------------------------------------------------------------------Save-Button-----------------------------------------------------------------
onPressSave: function () {
    this.onSavePanel(false);  
},
onSavePanel: async function (saveAfterSend) {
  const oAuth = this.getOwnerComponent().getModel("auth");
  const oTemplate = this.getView().getModel("template");
  const oDocCache = this.getView().getModel("docCache");
  const oSend = this.getView().getModel("send");

  const sType = oAuth?.getProperty("/tokenType");
  const sTok  = oAuth?.getProperty("/token");
  const sDocId = this._getCurrentDocumentId?.();

  if (!sTok || !sDocId || !oTemplate) { /* deine Toasts */ return; }

  // Template Werte
  const sKey = String(oTemplate.getProperty("/currentInvoiceKey") || "").trim();
  const sBasePath = sKey ? ("/invoices/" + sKey) : null;
  if (!sBasePath) { MessageToast.show("No current invoice key."); return; }

  const sSubject = (oTemplate.getProperty(sBasePath + "/subject") || "").trim();
  const sBody    = (oTemplate.getProperty(sBasePath + "/body") || "").trim();
  var sRecipient = (oSend.getProperty("/recipient") || "").trim();
  var sNewRecipient = this.byId("inpRecipient").getValue().trim();
  var sDeliveryMethod = ("ccDM_" + this.sOldDeliveryMethod).trim();
  var sNewDeliveryMethod = ("ccDM_" + this.byId("delMeth").getSelectedItem()?.getText()).trim();
  var sTransferFormat = ("ccBF_" + this._sOldTransferFormat).trim();
  var sNewTransferFormat = ("ccBF_" + this.byId("transF").getSelectedItem()?.getText()).trim();
  
  if (sRecipient != sNewRecipient){
    sRecipient = sNewRecipient;
  }

  if (sDeliveryMethod !== sNewDeliveryMethod){
    sDeliveryMethod = sNewDeliveryMethod;
  }
  if(sDeliveryMethod == "ccBF_Postal Service"){
    sDeliveryMethod = "ccBF_PostalService"
  }

  if (sTransferFormat !== sNewTransferFormat) {
    // speichern
    sTransferFormat = sNewTransferFormat; // optional nach Save aktualisieren
  }
  if (sTransferFormat == "ccBF_XRechnung") {
    sTransferFormat = "ccBF_XInvoice"
  }
  if (sTransferFormat == "ccBF_ZUGFeRD"){
    sTransferFormat = "ccBF_FacturX"
  }


  // ✅ volles Dokument aus Cache holen
  const oDoc = oDocCache?.getProperty("/doc");
  const sCachedId = oDocCache?.getProperty("/docId");
  if (!oDoc || sCachedId !== sDocId) {
    MessageToast.show("Document not loaded yet. Please reload and try again.");
    return;
  }

  // ✅ Deep copy, dann Werte setzen backend>MetaData/Object/Data/Basics/Recipient/Email/0/Address
  const oFull = JSON.parse(JSON.stringify(oDoc));
  oFull.MetaData ??= {};
  oFull.MetaData.Object ??= {};
  oFull.MetaData.Object.Data ??= {};
  oFull.MetaData.Object.Data.Subject = sSubject;
  oFull.MetaData.Object.Data.AdditionalInformation = sBody;
  oFull.MetaData.Object.Data.Basics.TransferFormat = sTransferFormat;
  oFull.MetaData.Object.Data.Basics.deliveryMethod = sDeliveryMethod;
  oFull.MetaData.Object.Data.Basics.Recipient.Email[0].Address = sRecipient;
  //Test
  const sBase = "https://test.app.clarc.com:443/application/api/v1/documenthub";
  //cci001
  // const sBase = "https://cci001.app.clarc.com:443/application/api/v1/documenthub";
  const sUrl1 = `${sBase}/document(${encodeURIComponent(sDocId)})`;
  const sUrl2 = `${sBase}/document/${encodeURIComponent(sDocId)}`;

  const oHeaders = {
    "Authorization": `${sType} ${sTok}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
  };

  try {
    let r = await fetch(sUrl1, { method: "PUT", headers: oHeaders, body: JSON.stringify(oFull) });
    if (!r.ok) r = await fetch(sUrl2, { method: "PUT", headers: oHeaders, body: JSON.stringify(oFull) });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} ${r.statusText}${t ? " - " + t : ""}`);
    }

    // optional: Cache mit Response aktualisieren (falls Backend Felder ergänzt)
    const oSaved = await r.json().catch(() => null);
    if (oSaved && oDocCache) oDocCache.setProperty("/doc", oSaved);
    if (saveAfterSend == false){
      MessageToast.show("Data saved.");
      oDocCache.setProperty("/canSave", false);
    }
  } catch (e) {
    MessageToast.show(`Save failed: ${e.message || e}`);
    console.error("Template save failed:", e);
  }
},



    });
});
