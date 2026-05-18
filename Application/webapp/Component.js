sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("demo.app.demoapp.Component", {
    metadata: {
      manifest: "json",
      interfaces: [
        "sap.ui.core.IAsyncContentCreation"
      ]
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Backend-Model anlegen (damit Views darauf binden können)


      const oBackendModel = new JSONModel();
      this.setModel(oBackendModel, "backend");

      // const oStatisticModel = new JSONModel();
      // this.setModel(oStatisticModel, "statistic")

      const oBillingConfigModel = new JSONModel();
      this.setModel(oBillingConfigModel, "billingConfig")

      const oAuthModel = new JSONModel({ tokenType: "", token: "" });
      this.setModel(oAuthModel, "auth");

      const oFilterModel = new JSONModel({
        /* ===== ValueHelps ===== */
        StatusList: [],
        RecipientNameList: [],
        SalesOrganisationList: [],
        InvoiceTypeList: [],
        SubTypeList: [],

        /* ===== User Values ===== */
        globalSearch: "",
        selectedStates: [],
        recipientName: "",
        nettoValue: "",
        invoiceNo: "",
        salesOrganisation: [],
        invoiceType: [],
        subType: "",
        factDateFrom: null,
        factDateTo: null
      });
      this.setModel(oFilterModel, "filterModel");

      // Routing starten
      this.getRouter().initialize();

      // Daten im Hintergrund laden
      this._loadBackendData();

    },

    // öffentliche Methode für Controller
    reloadBackendData: function () {
      return this._loadBackendData();
    },

    _loadBackendData: async function () {
      const billingConfigUrl =
        "/application/api/v1/bpm/billing" +
        "?$expand=SalesOrgs" +
        "&$filter=(Name eq 'Default')";
      try {
        // 2) Mehrere Datenquellen parallel laden
        const [billingResp] = await Promise.all([
          fetch(billingConfigUrl, {
            method: "GET",
            credentials: "include",
            headers: {
              "Accept": "application/json"
            }
          })
        ]);

        if (!billingResp.ok) {
          console.error("Billing Config Request Error:", billingResp.status);
          return;
        }

        const billingJson = await billingResp.json();
        this.getModel("billingConfig").setData(billingJson);

        this._rebuildFilter();
      } catch (e) {
        console.error("Fehler beim Laden:", e);
      }
      //-----------------------------------------------------------------------------------------------------------------------------------
    },
    //baut das Modell filterModel aus, das Modell wird für Filtering eingesetzt
    _rebuildFilter: function () {
      const oBillingConfig = this.getModel("billingConfig");
      const oFb = this.getModel("filterModel");

      if (!oBillingConfig || !oFb) {
        return;
      }
      // --------------------
      // A) Status aus /States
      // --------------------
      var mStates = ["Finished", "User Action", "Error"];

      oFb.setProperty(
        "/StatusList",
        mStates.slice().sort().map(function (s) {
          return { key: s, text: s };
        })
      );

      // -------------------------------------
      // B) Sales Orgs aus billingConfig.value[0].SalesOrgs
      // -------------------------------------
      const aCfg = oBillingConfig.getProperty("/value") || [];
      const aSalesOrgs = (aCfg[0] && Array.isArray(aCfg[0].SalesOrgs)) ? aCfg[0].SalesOrgs : [];

      const mSales = Object.create(null);

      aSalesOrgs.forEach(function (o) {
        const sCode = (o && o.Code) ? String(o.Code).trim() : "";
        if (sCode) {
          mSales[sCode] = true;
        }
      });

      oFb.setProperty(
        "/SalesOrganisationList",
        Object.keys(mSales).sort().map(function (s) {
          return { key: s, text: s };
        })
      );
      // -------------------------------------
      // C) Invoice Type (hard codiert)
      // -------------------------------------
      var mTypes = ["CreditNote", "Invoice", "Common"];

      oFb.setProperty(
        "/InvoiceTypeList",
        mTypes.slice().sort().map(function (s) {
          return { key: s, text: s };
        })
      );
    },
  });
});
