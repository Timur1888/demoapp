sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/Token",
  "sap/ui/model/Sorter",
  "sap/m/table/columnmenu/QuickSortItem"
], function (
  Fragment,
  Filter,
  FilterOperator,
  Token,
  Sorter,
  QuickSortItem
) {
  "use strict";

  return {

    /**
 * Lädt Rechnungen serverseitig (REST mit $select/$filter/$top/$skip/$orderby)
 * und schreibt Ergebnis nach backend>/value.
 *
 * Erwartet: this.getOwnerComponent().getModel("backend") ist ein JSONModel
 * Optional: backend>/busy, backend>/error, backend>/skip, backend>/top, backend>/hasMore, backend>/count
 *
 * Usage:
 *   await this._loadInvoicesServer({ top: 40, skip: 0, filter: sFilter, append: false });
 *   await this._loadInvoicesServer({ append: true }); // lädt nächste Seite
 */
_loadInvoicesServer: async function (mOpts) {
  mOpts = mOpts || {};

  const oAuth    = this.getOwnerComponent().getModel("auth");
  // Token
  const sType = (oAuth?.getProperty("/tokenType") || "Bearer").trim();
  const sTok  = (oAuth?.getProperty("/token") || "").trim();

  const oBackend = this.getOwnerComponent().getModel("backend");
  if (!oBackend) {
    throw new Error('Model "backend" not found');
  }

  // Defaults aus Model (für "Load more")
  const nTop  = Number(mOpts.top  != null ? mOpts.top  : (oBackend.getProperty("/top")  || 40));
  const nSkip = Number(mOpts.skip != null ? mOpts.skip : (oBackend.getProperty("/skip") || 0));

  const bAppend  = !!mOpts.append;
  const sFilter  = (mOpts.filter || "").trim();           // kompletter Filter (base + user)
  const sOrderBy = (mOpts.orderBy || "CreationDate desc");
  //test
  // const sBaseUrl = (mOpts.baseUrl || "https://test.app.clarc.com");
  //cci001
  const sBaseUrl = (mOpts.baseUrl || "https://cci001.app.clarc.com");
  const sPath    = (mOpts.path || "/application/api/v1/documenthub/document");

  // Wichtig: Blobs/MetaData sind oft groß -> ggf. für Liste abwählen
const sSelect = [
  "Id",
  "History",
  "Rights",
  "State",
  "Process.DeliveryPlan.ExecutionMode",

  "MetaData.Object.Data.Basics.Recipient.Name",
  "MetaData.Object.Data.Basics.Recipient.Email",
  "MetaData.Object.Data.Basics.Number.Value",
  "MetaData.Object.Data.Type",
  "MetaData.Object.Data.SubType",
  "MetaData.Object.Data.Amounts.Net.Value",
  "MetaData.Object.Data.Amounts.Gross.Value",
  "MetaData.Object.Data.Amounts.Currency.Value",

  "MetaData.OriginSystem",
  "MetaData.Object.Data.BusinessPartners",
  "History.Created.Date",
  "MetaData.Object.Data.Basics.Date.Value",
  "MetaData.Object.Data.Basics.SendDate",
  "MetaData.Object.Data.Basics.TransferFormat",
  "MetaData.Object.Data.Basics.DeliveryMethod",

  // ⚠️ bewusst behalten (wichtig!)
  "MetaData"
].join(",");

  // Busy / Error UI State
  oBackend.setProperty("/busy", true);
  oBackend.setProperty("/error", "");

  try {
    // Query Params
    const mParams = {
      "$select": sSelect,
      "$top": String(nTop),
      "$skip": String(nSkip),
      "$orderby": sOrderBy
    };
    if (sFilter) {
      mParams["$filter"] = sFilter;
    }

    const sUrl = this._buildUrl(sBaseUrl + sPath, mParams);

    const r = await fetch(sUrl, {
      method: "GET",
      credentials: "include",
      headers: {
        "Authorization": `${sType} ${sTok}`
        // Auth i.d.R. über Approuter/Destination
      }
    });

    if (!r.ok) {
      // versuche backend-message zu lesen
      let sDetails = "";
      try {
        sDetails = await r.text();
      } catch (e) { /* ignore */ }
      throw new Error(`HTTP ${r.status} ${r.statusText}${sDetails ? " - " + sDetails : ""}`);
    }

    const data = await r.json();
    const aNew = Array.isArray(data.value) ? data.value : [];

    // bestehende Daten
    const aOld = Array.isArray(oBackend.getProperty("/value")) ? oBackend.getProperty("/value") : [];

    // schreiben
    if (bAppend) {
      oBackend.setProperty("/value", aOld.concat(aNew));
      oBackend.setProperty("/skip", nSkip + nTop);
    } else {
      oBackend.setProperty("/value", aNew);
      oBackend.setProperty("/skip", nSkip);
    }

    oBackend.setProperty("/top", nTop);

    // hasMore Heuristik (wenn genau nTop zurückkommt, könnte es mehr geben)
    oBackend.setProperty("/hasMore", aNew.length === nTop);

    // optional: count wenn Backend liefert (z.B. @odata.count)
    if (data["@odata.count"] != null) {
      oBackend.setProperty("/count", data["@odata.count"]);
    }

    return data;

  } catch (e) {
    oBackend.setProperty("/error", e.message || String(e));
    oBackend.setProperty("/value", bAppend ? (oBackend.getProperty("/value") || []) : []);
    throw e;
    

  } finally {
    
    oBackend.setProperty("/busy", false);

  }
},


/**
 * Baut URL mit encoded query params.
 * sBase kann bereits Query enthalten (wird nicht erwartet, aber unterstützt).
 */
_buildUrl: function (sBase, mParams) {
  const a = [];
  Object.keys(mParams || {}).forEach(function (k) {
    let v = mParams[k];
    if (v === undefined || v === null || v === "") return;

    let sVal = String(v);

    // 🔥 Sonderfall: Backend erwartet Quotes als %27
    if (k === "$filter") {
      sVal = encodeURIComponent(sVal).replace(/'/g, "%27");
    } else {
      sVal = encodeURIComponent(sVal);
    }

    a.push(encodeURIComponent(k) + "=" + sVal);
  });

  return sBase + (sBase.includes("?") ? "&" : "?") + a.join("&");
},

_buildUserFilter: function (oFilterM) {
  const aAnd = [];

  // 0) Globale Suche (OR über mehrere Felder)
  const sGlobal = (oFilterM.getProperty("/globalSearch") || "").trim();
  if (sGlobal) {
    const aSearchPaths = [
      "MetaData/Object/Data/Basics/Number/Value",
      "MetaData/Object/Data/Basics/Recipient/Name",
      "MetaData/Object/Data/Basics/Recipient/Email",
      "MetaData/Object/Data/BusinessPartners/LeitwegId/Value",
      "MetaData/Object/Data/BusinessPartners/SalesOrganisation/Value"
    ];
    const sOr = this._buildContainsiOrWildcardGroup(sGlobal, aSearchPaths);
    if (sOr) aAnd.push(sOr);
  }

  // 1) Status (eq, OR)
  const aStatuses = oFilterM.getProperty("/selectedStates") || [];
  if (Array.isArray(aStatuses) && aStatuses.length) {
    const aNormalized = aStatuses.map(s => {
      if (!s) {
        return null;
      }
      let sState = String(s).trim(); //entfernt Leerzeichen am Anfang und Ende eines Strings
      sState = sState.replace(/\s+/g, ""); // "User Action" → "UserAction"
        sState = "ccDS_" + sState;
      return sState;
    }).filter(Boolean);
    if (aNormalized.length) {
      const sOr = aNormalized
        .map(s => `State eq '${this._escapeOData(s)}'`)
        .join(" or ");

      aAnd.push(`(${sOr})`);
    }
  }


  // 2) Recipient Name (Containsi)
  const sRec = (oFilterM.getProperty("/recipientName") || "").trim();
  if (sRec) {
    const s = this._buildContainsiOrWildcardGroup(
      sRec,
      ["MetaData/Object/Data/Basics/Recipient/Name"]
    );
    if (s) aAnd.push(s);
  }

  // 3) Invoice No (Containsi)
  const sInv = (oFilterM.getProperty("/invoiceNo") || "").trim();
  if (sInv) {
    const s = this._buildContainsiOrWildcardGroup(
      sInv,
      ["MetaData/Object/Data/Basics/Number/Value"]
    );
    if (s) aAnd.push(s);
  }

  // 4) SalesOrganisation (MultiComboBox, EQ)
  const aSales = oFilterM.getProperty("/salesOrganisation") || [];

  if (Array.isArray(aSales) && aSales.length) {
    const sOr = aSales
      .map(code =>
        `MetaData/Object/Data/BusinessPartners/0/SalesOrganisation/Value eq '${this._escapeOData(code)}'`
      )
      .join(" or ");

    aAnd.push(`(${sOr})`);
  }


  // 5) InvoiceType (MultiComboBox, EQ)
  const aTypesRaw = oFilterM.getProperty("/invoiceType") || []; // z.B. ["Invoice","CreditNote"] oder ["ccIT_Invoice"]

  if (Array.isArray(aTypesRaw) && aTypesRaw.length) {
    const aTypes = aTypesRaw
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(s => (s.startsWith("ccIT_") ? s : "ccIT_" + s));

    const sOr = aTypes
      .map(s => `MetaData/Object/Data/Type eq '${this._escapeOData(s)}'`)
      .join(" or ");

    aAnd.push(`(${sOr})`);
  }

  // 6) SubType (eq)
  const sSub = (oFilterM.getProperty("/subType") || "").trim();
  if (sSub) {
    aAnd.push(`(MetaData/Object/Data/SubType eq '${this._escapeOData(sSub)}')`);
  }

  // 7) NettoValue:
  const sNettoRaw = (oFilterM.getProperty("/nettoValue") || "").trim();
  if (sNettoRaw) {
    const sNetto = this._buildNettoFilterForClarc(
      sNettoRaw,
      "MetaData/Object/Data/Amounts/Net/Value"
    );

    if (sNetto === "__INVALID__") {
      return "__INVALID__"; // verhindert "Bitte mindestens einen Filter setzen"
    }
    if (sNetto) aAnd.push(sNetto);
  }


  // 8) Factura DateRange -> History/Created/Date mit UTC Tagesgrenzen
  const dFrom = oFilterM.getProperty("/factDateFrom"); // Date oder "yyyy-MM-dd"
  const dTo   = oFilterM.getProperty("/factDateTo");

  const sDate = this._buildUtcDateTimeRangeFilter(
    "MetaData/Object/Data/Basics/Date/Value",
    dFrom,
    dTo
  );
  if (sDate) aAnd.push(sDate);

  return aAnd.join(" and ");
},


/**
 * CLARC-Style "Containsi(Field,'x')" + Wildcards mit '*'
 *
 * - "mann" -> Containsi(Field,'mann')
 * - "*ma*" -> Containsi(Field,'ma')
 * - "ab*cd" -> (Containsi(Field,'ab') and Containsi(Field,'cd'))
 *
 * Mehrere Paths => OR-Gruppe.
 */
_buildContainsiOrWildcardGroup: function (sQuery, aPaths) {
  if (!sQuery || !aPaths || !aPaths.length) return "";

  const s = String(sQuery).trim();
  if (!s) return "";
  if (/^\*+$/.test(s)) return "";

  const aSegs = s.split("*").map(x => x.trim()).filter(Boolean);
  const aNeedles = aSegs.length ? aSegs : [s];

  const aPerPath = aPaths.map(path => {
    const aParts = aNeedles.map(needle =>
      `Containsi(${path},'${this._escapeOData(needle)}')`
    );
    return aParts.length > 1 ? `(${aParts.join(" and ")})` : aParts[0];
  });

  return aPerPath.length > 1 ? `(${aPerPath.join(" or ")})` : aPerPath[0];
},


/**
 * NettoValue numeric:
 * - "3000"            -> (path eq 3000)
 * - "7000-8000"       -> (path ge 7000 and path le 8000)
 * - "7000 - 8000"     -> dito
 */
_buildNettoFilterForClarc: function (sInput, sPath) {
  const raw = String(sInput || "").trim();
  if (!raw) return "";

  if (raw.includes("*")) {
    sap.m.MessageToast.show("Ungültige Eingabe");
    return "__INVALID__";
  }
  // Helper: Zahl tolerant parsen (auch "1.500,00 €" -> 1500)
  const parseNum = (s) => {
    const cleaned = String(s || "")
      .replace(/[^\d,.\s-]/g, "")  // € usw. raus
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  // Range-Erkennung: genau ein "-" zwischen zwei Teilen
  // akzeptiert "7000-8000" oder "7000 - 8000"
  const m = raw.match(/^\s*(.+?)\s*-\s*(.+?)\s*$/);
  if (m) {
    const nFrom = parseNum(m[1]);
    const nTo   = parseNum(m[2]);
    if (nFrom === null || nTo === null) {
      sap.m.MessageToast.show("Netto Value: Bitte zwei gültige Zahlen eingeben (z.B. 7000-8000).");
      return "__INVALID__";
    }
    if (nFrom > nTo) {
      sap.m.MessageToast.show("Netto Value: 'Von' muss kleiner oder gleich 'Bis' sein.");
      return "__INVALID__";
    }
    return `(${sPath} ge ${nFrom} and ${sPath} le ${nTo})`;
  }
  // Single value
  const n = parseNum(raw);
  if (n === null) {
    sap.m.MessageToast.show("Netto Value: Bitte eine gültige Zahl eingeben (z.B. 1500) oder einen Bereich (z.B. 7000-8000).");
    return "__INVALID__";
  }

  return `(${sPath} eq ${n})`;
},


/**
 * DateRange -> UTC Datetime mit Tagesgrenzen wie in eurem Beispiel:
 * ge YYYY-MM-DDT23:00:00.000Z
 * le YYYY-MM-DDT22:59:59.999Z
 *
 * Das entspricht CET/CEST-Umrechnung (Deutschland):
 * - Start of day local -> UTC = Vortag 23:00 (bei CET)
 * - End of day local   -> UTC = 22:59:59.999 (bei CET)
 *
 * Damit es auch in Sommerzeit korrekt ist, nehmen wir Date-Objekte
 * und konvertieren "lokaler Tag" nach UTC via toISOString().
 */
_buildUtcDateTimeRangeFilter: function (sPath, vFrom, vTo) {
  const dFrom = this._toDateObject(vFrom);
  const dTo   = this._toDateObject(vTo);

  if (!dFrom && !dTo) return "";

  const a = [];

  if (dFrom) {
    // lokaler Tagesanfang -> ISO (UTC)
    const dStart = new Date(dFrom.getFullYear(), dFrom.getMonth(), dFrom.getDate(), 0, 0, 0, 0);
    a.push(`${sPath} ge ${this._formatIsoNoQuotes(dStart)}`);
  }

  if (dTo) {
    // lokaler Tagesende -> ISO (UTC)
    const dEnd = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate(), 23, 59, 59, 999);
    a.push(`${sPath} le ${this._formatIsoNoQuotes(dEnd)}`);
  }

  return a.length > 1 ? `(${a.join(" and ")})` : `(${a[0]})`;
},


/**
 * Accepts Date or "yyyy-MM-dd" -> Date (local)
 */
_toDateObject: function (v) {
  if (!v) return null;

  if (v instanceof Date && !isNaN(v.getTime())) return v;

  if (typeof v === "string") {
    const s = v.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const dt = new Date(y, mo, d, 0, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  return null;
},

/**
 * Eure Beispiele haben DateTime OHNE Quotes:
 * ... ge 2025-12-05T23:00:00.000Z
 * Darum geben wir ISO ohne '...' zurück.
 */
_formatIsoNoQuotes: function (d) {
  return d.toISOString(); // "2025-12-05T23:00:00.000Z"
},

_escapeOData: function (s) {
  return String(s).replace(/'/g, "''");
},




//--------------------------------------------------------------------------------------------------------------------------------------------------------------------

    //macht Fragment für die Sortierung einzelner Spalten generisch
    _attachPerColumnMenus: function () {
      const oView = this.getView();
      const oTable = this.byId("tblBilling");

      const aPromises = oTable.getColumns().map((oCol) => {
        const sSortKey = (oCol.data("sortKey") || "").trim();
        if (!sSortKey) return Promise.resolve();

        return Fragment.load({
          id: oView.getId() + "--" + oCol.getId(),
          name: "demo.app.demoapp.view.fragments.ColumnMenu",
          controller: this
        }).then((oMenu) => {
          oView.addDependent(oMenu);
          this._aColumnMenus.push(oMenu);

          let oQuickSort = null;
          if (oMenu.getItems) {
            oQuickSort = oMenu.getItems().find(i => i.isA && i.isA("sap.m.table.columnmenu.QuickSort"));
          }
          if (!oQuickSort && oMenu.findAggregatedObjects) {
            const aFound = oMenu.findAggregatedObjects(true, oObj => oObj.isA && oObj.isA("sap.m.table.columnmenu.QuickSort"));
            oQuickSort = aFound && aFound[0];
          }
          if (!oQuickSort) return;

          const oHeader = oCol.getHeader();
          const sLabel = (oHeader && oHeader.getText) ? oHeader.getText() : sSortKey;

          oQuickSort.removeAllItems();

          const oQSI = new QuickSortItem({ key: sSortKey, label: sLabel });
          oQuickSort.addItem(oQSI);
          this._mQuickSortItemsByKey[sSortKey] = oQSI;

          oCol.setHeaderMenu(oMenu);
        });
      });

      return Promise.all(aPromises);
    },
    
    _syncQuickSortUI: function () {
      const m = this._mQuickSortItemsByKey;
      if (!m) return;

      Object.values(m).forEach(oItem => oItem?.setSortOrder?.("None"));

      const st = this._oSortState;
      if (st?.path && m[st.path]?.setSortOrder) {
        m[st.path].setSortOrder(st.descending ? "Descending" : "Ascending");
      }
    },

    //Ermöglicht die Suche mit *
    _buildWildcardSearchFilter: function(sQuery, aPaths) {
      if (!sQuery) {
        return null;
      }

      var s = (sQuery || "").trim();
      if (!s) {
        return null;
      }

      // entferne Rand-* und ignoriere Query nur aus Sternen
      var sCore = s.replace(/^\*+/, "").replace(/\*+$/, "");
      if (!sCore) {
        return null;
      }

      // ROBUST: immer Contains, damit JSONModel + Nested Paths sicher matchen
      var op = FilterOperator.Contains;

      return new Filter({
        filters: aPaths.map(function(sPath) {
          return new Filter(sPath, op, sCore);
        }),
        and: false
      });
    },

    //Helper für Datumvalidierung
    _validateDateDDMMYYYY: function(s) {
      // erwartet "dd.MM.yyyy"
      var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || "");
      if (!m) {
        return { ok: false };
      }

      var d = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var y = parseInt(m[3], 10);

      var yNow = new Date().getFullYear();

      if (mo < 1 || mo > 12) { return { ok: false, msg: "Month must be between 01 and 12." }; }
      if (y > yNow) { return { ok: false, msg: "Year must not be greater than " + yNow + "." }; }
      if (d < 1 || d > 31) { return { ok: false, msg: "Day must be between 01 and 31." }; }

      // echte Datumskonsistenz (z.B. 31.02) prüfen
      var dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== (mo - 1) || dt.getDate() !== d) {
        return { ok: false, msg: "Invalid calendar date." };
      }

      return { ok: true, date: dt };
    },

    //Popup schliessen
    _closeDRSPopup: function(oDRS) {
      var oPopup = oDRS && oDRS.getAggregation && oDRS.getAggregation("_popup");
      if (oPopup && oPopup.isOpen && oPopup.isOpen()) {
        oPopup.close();
      }
    },

    // @endregion
_onMultiInputValidate: function(oArgs) {
  if (oArgs.suggestionObject) {
    var o = oArgs.suggestionObject.getBindingContext("filterModel").getObject();
    return new Token({
      key: o.InvoiceNo,
      text: o.InvoiceNo + " (" + o.RecipientName + ")"
    });
  }
  return null;
},

//Filtriert interne Tabelle
_filterTable: function(oFilter) {
  var oVHD = this._oVHD;

  oVHD.getTableAsync().then(function(oTable) {
    if (oTable.bindRows) {
      oTable.getBinding("rows").filter(oFilter);
    }
    if (oTable.bindItems) {
      oTable.getBinding("items").filter(oFilter);
    }

    // This method must be called after binding update of the table.
    oVHD.update();
  });
},

_updateLabelsAndTable: function() {
  this.oExpandedLabel.setText(this.getFormattedSummaryTextExpanded());
  this.oSnappedLabel.setText(this.getFormattedSummaryText());
  this.oTable.setShowOverlay(true);
},

  };
});
