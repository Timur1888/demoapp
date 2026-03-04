sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "demo/app/demoapp/model/formatter",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
    "sap/m/List",
    "sap/m/CustomListItem",
    "sap/m/HBox",
    "sap/m/CheckBox",
    "sap/m/Popover",
    "sap/m/library",
    "sap/ui/comp/smartvariants/PersonalizableInfo",
    "sap/ui/model/type/String",
    "sap/m/Label",
    "sap/m/SearchField",
    "sap/m/Token",
    "sap/ui/table/Column",
    "sap/m/Column",
    "sap/m/Text",
    "sap/ui/model/Sorter",
    "sap/m/table/columnmenu/QuickSortItem",
    "demo/app/demoapp/util/View1Helper",
    "sap/m/library",
], function(

    Controller,
    UIComponent,
    JSONModel,
    Filter,
    FilterOperator,
    formatter,
    MessageBox,
    Fragment,
    List,
    CustomListItem,
    HBox,
    CheckBox,
    Popover,
    mLibrary,
    PersonalizableInfo,
    TypeString,
    Label,
    SearchField,
    Token,
    UIColumn,
    MColumn,
    Text,
    Sorter,
    QuickSortItem,
    View1Helper, 
    PlacementType,
) {
    "use strict";

    return Controller.extend("demo.app.demoapp.controller.View1", Object.assign({

        formatter: formatter,
        

        onInit: function() {
            var oView = this.getView();
            //------------Modelle-----------------------
            //Backend-Model
            var oBackend = this.getOwnerComponent().getModel("backend");
            oView.setModel(oBackend, "backend");

            //--------------------------------------------------

            //-----------FilterBar----------------------
            this.applyData = this.applyData.bind(this);
            this.fetchData = this.fetchData.bind(this);
            this.getFiltersWithValues = this.getFiltersWithValues.bind(this);

            //Controls einmal holen und als Property merken
            this.oSmartVariantManagement = this.getView().byId("svm");
            this.oExpandedLabel = this.getView().byId("expandedLabel");
            this.oSnappedLabel = this.getView().byId("snappedLabel");

            // XML: <filterModel:FilterBar id="filterbar" ...>
            this.oFilterBar = this.getView().byId("filterbar");

            this.oTable = this.getView().byId("tblBilling");

            // FilterBar mit Variant-Mechanik verbinden
            this.oFilterBar.registerFetchData(this.fetchData);
            this.oFilterBar.registerApplyData(this.applyData);
            this.oFilterBar.registerGetFiltersWithValues(this.getFiltersWithValues);

            // SmartVariantManagement “personalizable” machen
            var oPersInfo = new PersonalizableInfo({
                type: "filterBar",
                keyName: "persistencyKey",
                dataSource: "",
                control: this.oFilterBar
            });
            this.oSmartVariantManagement.addPersonalizableControl(oPersInfo);
            //--------------------------------------------------

            //--------------------Sortierung--------------------- 
            this._aColumnMenus = [];
            this._fnItemsBindingChange = null;
            this._mQuickSortItemsByKey = Object.create(null);
            this._oSortState = { path: "", descending: false };

            this._attachPerColumnMenus().then(() => {
            this._syncQuickSortUI(); // wenn Variant schon Sort gesetzt hat
            });
            this._oSortState = { path: "", descending: false };
            //-----------------------------------------------------
            this._bSvmReady = false;
            this.oSmartVariantManagement.initialise(function () {
            this._bSvmReady = true;
            }.bind(this), this.oFilterBar);
        },

        //::::::::::::::::::::::::::::::::::::::::::::::SOTRIERUNG:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        onSortChange: function (oEvent) {
        const oTable = this.byId("tblBilling");
        const oBinding = oTable.getBinding("items");

        const oItem = oEvent.getParameter("item"); // QuickSortItem
        const sPath = oItem.getKey();
        const sOrder = oItem.getSortOrder();

        if (sOrder === "None") {
            this._oSortState = { path: "", descending: false };
            oBinding.sort(); // reset
        } else {
            const bDesc = (sOrder === "Descending");
            this._oSortState = { path: sPath, descending: bDesc };
            oBinding.sort([new Sorter(sPath, bDesc)]);
        }

        this._syncQuickSortUI();
        // wichtig: Variante als geändert markieren
        this.oSmartVariantManagement.currentVariantSetModified(true);
        },
        //::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::Filter::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
        //zentrale Funktion, die alle Filter anwendet
        onSearch: async  function(oEvent) {
            var oBackend = this.getOwnerComponent().getModel("backend");
            if (!this._bSvmReady) {
                return; // nur frühe Init-Searchs blocken
            }

            const oRouter = UIComponent.getRouterFor(this);
            oRouter.navTo("RouteView1", {}, true);

            const oMainViewModel = this.getView().getModel("mainView");
            if (oMainViewModel) {
                oMainViewModel.setProperty("/layout", "OneColumn");
                
            }

            this.oSmartVariantManagement.currentVariantSetModified(true);
            this.oFilterBar.fireFilterChange(oEvent || {});

            const oFilterM = this.getOwnerComponent().getModel("filterModel");
            const sBaseFilter = "(Process/Manager/Type eq 'ccPM_Billing')";
            const sUserFilter = (this._buildUserFilter(oFilterM) || "").trim();

            if (sUserFilter === "__INVALID__") {
                oBackend.setProperty("/value", []);
                return;
            }

            // Wenn nichts gesetzt → erste 40 Rechnungen holen
            if (!sUserFilter) {
                try {
                    //Test
                    const first40BillingsURL = "https://test.app.clarc.com/application/api/v1/documenthub/document?$select=Id,History,Rights,State,Process.DeliveryPlan.ExecutionMode,MetaData.Object.Data.Basics.Recipient.Name,MetaData.Object.Data.Basics.Recipient.Email,MetaData.Object.Data.Basics.Number.Value,MetaData.Object.Data.Type,MetaData.Object.Data.SubType,MetaData.Object.Data.Amounts.Net.Value,MetaData.Object.Data.Amounts.Gross.Value,MetaData.Object.Data.Amounts.Currency.Value,MetaData.OriginSystem,MetaData.Object.Data.BusinessPartners,History.Created.Date,MetaData.Object.Data.Basics.Date.Value,MetaData.Object.Data.Basics.SendDate,MetaData.Object.Data.Basics.TransferFormat,MetaData.Object.Data.Basics.DeliveryMethod,MetaData.Object.Data.BusinessPartners,MetaData.Blobs,MetaData&$filter=(Process/Manager/Type%20eq%20%27ccPM_Billing%27)%20and%20(State%20eq%20%27ccDS_Finished%27)%20or%20(State%20eq%20%27ccDS_UserAction%27)%20or%20(State%20eq%20%27ccDS_Error%27)&$top=40&$orderby=CreationDate%20desc";
                    //cci001
                    // const first40BillingsURL = "https://cci001.app.clarc.com/application/api/v1/documenthub/document?$select=Id,History,Rights,State,Process.DeliveryPlan.ExecutionMode,MetaData.Object.Data.Basics.Recipient.Name,MetaData.Object.Data.Basics.Recipient.Email,MetaData.Object.Data.Basics.Number.Value,MetaData.Object.Data.Type,MetaData.Object.Data.SubType,MetaData.Object.Data.Amounts.Net.Value,MetaData.Object.Data.Amounts.Gross.Value,MetaData.Object.Data.Amounts.Currency.Value,MetaData.OriginSystem,MetaData.Object.Data.BusinessPartners,History.Created.Date,MetaData.Object.Data.Basics.Date.Value,MetaData.Object.Data.Basics.SendDate,MetaData.Object.Data.Basics.TransferFormat,MetaData.Object.Data.Basics.DeliveryMethod,MetaData.Object.Data.BusinessPartners,MetaData.Blobs,MetaData&$filter=(Process/Manager/Type%20eq%20%27ccPM_Billing%27)%20and%20(State%20eq%20%27ccDS_Finished%27)%20or%20(State%20eq%20%27ccDS_UserAction%27)%20or%20(State%20eq%20%27ccDS_Error%27)&$top=40&$orderby=CreationDate%20desc";
                    var oAuthModel = this.getOwnerComponent().getModel("auth");
                    // 2) Mehrere Datenquellen parallel laden
                    const [billingResp] = await Promise.all([
                    fetch(first40BillingsURL, {
                        method: "GET",
                        credentials: "include",
                        headers: {
                        "Authorization":
                            (oAuthModel?.getProperty("/tokenType") || "Bearer").trim() + " " + (oAuthModel?.getProperty("/token")).trim()
                        }
                    })
                    ]);
                    if (!billingResp.ok) {
                    console.error("Billing Request Error:", billingResp.status);
                    return;
                    }

                    const billingJson = await billingResp.json();
                    oBackend.setData(billingJson);
                } catch (e) {
                    console.error("Fehler beim Laden:", e);
                }
                this.oTable.setShowOverlay(false);
                return;
            }

            const sFilter = sUserFilter ? `(${sBaseFilter}) and (${sUserFilter})` : sBaseFilter; //Userfilter leer -> nimm nur Basefilter. Wenn nicht leer, dann nimm beide Filter

            await this._loadInvoicesServer({ top: 40, skip: 0, filter: sFilter, append: false });
            
            this.oTable.setShowOverlay(false);
            // 🔔 KEINE TREFFER
            const aRows = this.getOwnerComponent().getModel("backend").getProperty("/value") || [];
            if (aRows.length === 0) {
                sap.m.MessageToast.show(
                "No results were found for the specified filters"
                );
            }

        },

        // ---------------------------------------------------
        // Settings-Button (Spalten ein-/ausblenden)
        // ---------------------------------------------------
        _createColumnSettingsPopover: function () {
        if (this._oColumnPopover) {
            return this._oColumnPopover;
        }

        const oTable   = this.byId("tblBilling");
        const aColumns = oTable.getColumns();

        const oList = new sap.m.List({
            items: aColumns.map(col => {
            const sColLabel = col.getHeader().getText();

            return new sap.m.CustomListItem({
                content: new sap.m.HBox({
                items: [
                    new sap.m.CheckBox({
                    selected: col.getVisible(),
                    text: sColLabel,
                    select: function (oEvent) {
                        col.setVisible(oEvent.getParameter("selected"));
                        this.oSmartVariantManagement.currentVariantSetModified(true);
                    }.bind(this)
                    }).addStyleClass("sapUiSmallMarginEnd")
                ]
                })
            });
            })
        });

        this._oColumnPopover = new sap.m.Popover({
            placement: sap.m.PlacementType.Auto,   // <= wichtig
            title: "Columns",
            contentWidth: "16rem",
            content: oList
        });

        this.getView().addDependent(this._oColumnPopover);
        return this._oColumnPopover;
        },

        onSettings: function (oEvent) {
        const oButton = oEvent.getSource();
        const oPop = this._createColumnSettingsPopover();
        // Toggle: wenn offen -> zu, sonst auf
        if (oPop.isOpen && oPop.isOpen()) {
            oPop.close();
            return;
        }
        oPop.openBy(oButton);
        },

        //hole den Filterzusatndustand, der im Variant gespeichert werden soll
        fetchData: function () {
        const aData = this.oFilterBar.getAllFilterItems().reduce(function (aResult, oFilterItem) {
            const oControl = oFilterItem.getControl();
            let vData;

            if (oControl && oControl.getSelectedKeys) {
            vData = oControl.getSelectedKeys();
            } else if (oControl && oControl.getValue) {
            vData = oControl.getValue();
            } else {
            vData = null;
            }

            aResult.push({
            groupName: oFilterItem.getGroupName(),
            fieldName: oFilterItem.getName(),
            fieldData: vData
            });
            return aResult;
        }, []);

        // Sortierung speichern
        aData.push({
            groupName: "TABLE",
            fieldName: "__SORT__",
            fieldData: this._oSortState // {path:"...", descending:true/false}
        });

        // Spaltenstatus speichern
        const oTable = this.byId("tblBilling");
        const aColsState = (oTable && oTable.getColumns ? oTable.getColumns() : []).map(function (oCol) {
            return {
            id: oCol.getId(),
            visible: oCol.getVisible()
            };
        });

        aData.push({
            groupName: "TABLE",
            fieldName: "__COLUMNS__",
            fieldData: aColsState
        });

        return aData;
        },


        //spiele den im Variant gespeicherten Filterzustand wieder ein
        //spiele den im Variant gespeicherten Filterzustand wieder ein
        applyData: function (aData) {
        // Filter
        aData.forEach(function (oDataObject) {
            if (oDataObject.fieldName === "__SORT__" || oDataObject.fieldName === "__COLUMNS__") { return; }

            const oControl = this.oFilterBar.determineControlByName(oDataObject.fieldName, oDataObject.groupName);
            if (!oControl) { return; }

            if (oControl.setSelectedKeys && Array.isArray(oDataObject.fieldData)) {
            oControl.setSelectedKeys(oDataObject.fieldData);
            } else if (oControl.setValue && typeof oDataObject.fieldData === "string") {
            oControl.setValue(oDataObject.fieldData);
            }
        }, this);

        // Sort
        const oSortEntry = aData.find(x => x.fieldName === "__SORT__");
        const st = oSortEntry && oSortEntry.fieldData;
        this._oSortState = st || { path: "", descending: false };

        const oBinding = this.byId("tblBilling").getBinding("items");
        if (oBinding) {
            if (!this._oSortState.path) {
            oBinding.sort(); // reset
            } else {
            oBinding.sort([new Sorter(this._oSortState.path, !!this._oSortState.descending)]);
            }
        }
        this._syncQuickSortUI();

        // Spaltenstatus
        const oColsEntry = aData.find(x => x.fieldName === "__COLUMNS__");
        const aColsState = oColsEntry && oColsEntry.fieldData;

        const applyColumns = function () {
            if (!Array.isArray(aColsState)) { return; }

            const oTable = this.byId("tblBilling");
            if (!oTable || !oTable.getColumns) { return; }

            const aCols = oTable.getColumns();
            if (!aCols || !aCols.length) { return; }

            // map: id -> column
            const mCols = Object.create(null);
            aCols.forEach(c => mCols[c.getId()] = c);

            aColsState.forEach(function (cState) {
            const oCol = mCols[cState.id];
            if (oCol && typeof cState.visible === "boolean") {
                oCol.setVisible(cState.visible);
            }
            });

            // Optional: falls Popover schon existiert, Checkboxen synchron halten
            if (this._oColumnPopover && this._oColumnPopover.getContent) {
            const aContent = this._oColumnPopover.getContent() || [];
            const oList = aContent[0];
            if (oList && oList.getItems) {
                oList.getItems().forEach(function (oCLI, idx) {
                const oHBox = oCLI.getContent && oCLI.getContent()[0];
                const oCB = oHBox && oHBox.getItems && oHBox.getItems()[0];
                const oColumn = aCols[idx];
                if (oCB && oCB.setSelected && oColumn) {
                    oCB.setSelected(oColumn.getVisible());
                }
                });
            }
            }
        }.bind(this);

        // Timeout (Option 4): falls Table/Columns noch nicht ready sind
        setTimeout(applyColumns, 0);
        },

        //Aktive Filter ermitteln gibt nur die Filter zurück, die aktuell wirklich einen Wert haben
        getFiltersWithValues: function() {
            return this.oFilterBar.getFilterGroupItems().reduce(function(aResult, oFilterGroupItem) {
                var oControl = oFilterGroupItem.getControl();

                // MultiComboBox / Controls mit SelectedKeys
                if (oControl && oControl.getSelectedKeys && oControl.getSelectedKeys().length > 0) {
                    aResult.push(oFilterGroupItem);

                    // Input / SearchField / Controls mit Value
                } else if (oControl && oControl.getValue && oControl.getValue().trim().length > 0) {
                    aResult.push(oFilterGroupItem);

                    // ✅ MultiInput: Tokens zählen als "Filter hat Wert"
                } else if (oControl && oControl.getTokens && oControl.getTokens().length > 0) {
                    aResult.push(oFilterGroupItem);
                }

                return aResult;
            }, []);
        },

        // Neuses Filter wurde hinzugefügt: Variant/Labels aktualisieren
        onAddFilter: function (oEvent) {
        if (this.oSmartVariantManagement?.currentVariantSetModified) {
            this.oSmartVariantManagement.currentVariantSetModified(true);
        }
        if (this.oFilterBar?.fireFilterChange) {
            this.oFilterBar.fireFilterChange(oEvent || {});
        }
        },
        onFilterChange: function() {
            this._updateLabelsAndTable();
        },

        onAfterVariantLoad: function() {
            this._updateLabelsAndTable();
        },

        getFormattedSummaryText: function() {
            var aFiltersWithValues = this.oFilterBar.retrieveFiltersWithValues();

            if (aFiltersWithValues.length === 0) {
                return "No filters active";
            }

            if (aFiltersWithValues.length === 1) {
                return aFiltersWithValues.length + " filter active: " + aFiltersWithValues.join(", ");
            }

            return aFiltersWithValues.length + " filters active: " + aFiltersWithValues.join(", ");
        },

        getFormattedSummaryTextExpanded: function() {
            var aFiltersWithValues = this.oFilterBar.retrieveFiltersWithValues();

            if (aFiltersWithValues.length === 0) {
                return "No filters active";
            }

            var sText = aFiltersWithValues.length + " filters active",
                aNonVisibleFiltersWithValues = this.oFilterBar.retrieveNonVisibleFiltersWithValues();

            if (aFiltersWithValues.length === 1) {
                sText = aFiltersWithValues.length + " filter active";
            }

            if (aNonVisibleFiltersWithValues && aNonVisibleFiltersWithValues.length > 0) {
                sText += " (" + aNonVisibleFiltersWithValues.length + " hidden)";
            }

            return sText;
        },


        //löscht alle Filter
        onClearFilters: function(oEvent) {
            // this.getOwnerComponent().getModel("backend").setProperty("/value", []);

            (this.oFilterBar.getFilterGroupItems() || []).forEach(function(oFGI) {
                var oC = oFGI.getControl();
                if (!oC) {
                    return;
                }

                // SearchField/Input
                if (oC.setValue) {
                    oC.setValue("");
                }

                // MultiComboBox
                if (oC.setSelectedKeys) {
                    oC.setSelectedKeys([]);
                }

                // DateRangeSelection
                if (oC.setDateValue) {
                    oC.setDateValue(null);
                }
                if (oC.setSecondDateValue) {
                    oC.setSecondDateValue(null);
                }

                // ValueState reset
                if (oC.setValueState) {
                    oC.setValueState(sap.ui.core.ValueState.None);
                }
                if (oC.setValueStateText) {
                    oC.setValueStateText("");
                }
            });

            this.oSmartVariantManagement.currentVariantSetModified(false);
            this.oFilterBar.fireFilterChange(oEvent || {});
            this.oTable.setShowOverlay(false);
        },

        //-------------------------------------------------------------DateRangeSelection: Factura Date-----------------------------------------
        //wird bei Datumänderung getriggert
        onFacturaDateChange: function(oEvent) {
            var oDRS = oEvent.getSource();
            var sText = (oDRS.getValue() || "").trim();

            // leer -> ok
            if (!sText) {
                oDRS.setValueState(sap.ui.core.ValueState.None);
                oDRS.setValueStateText("");
                this.onAddFilter();
                this._closeDRSPopup(oDRS);
                return;
            }

            // erlaubt: "dd.MM.yyyy - dd.MM.yyyy"
            var aParts = sText.split("-").map(function(x) {
                return x.trim();
            });

            // ange-only erzwingen
            if (aParts.length !== 2) {
                oDRS.setValueState(sap.ui.core.ValueState.Error);
                oDRS.setValueStateText("Please select a date range (from - to).");
                oDRS.setDateValue(null);
                oDRS.setSecondDateValue(null);
                return;
            }

            var rFrom = this._validateDateDDMMYYYY(aParts[0]);
            var rTo = this._validateDateDDMMYYYY(aParts[1]);

            if (!rFrom.ok || !rTo.ok) {
                oDRS.setValueState(sap.ui.core.ValueState.Error);
                oDRS.setValueStateText((!rFrom.ok ? rFrom.msg : rTo.msg) || "Invalid date range.");
                oDRS.setDateValue(null);
                oDRS.setSecondDateValue(null);
                return;
            }

            // Optional: von > bis verhindern
            if (rFrom.date.getTime() > rTo.date.getTime()) {
                oDRS.setValueState(sap.ui.core.ValueState.Error);
                oDRS.setValueStateText("'From' date must be before 'To' date.");
                oDRS.setDateValue(null);
                oDRS.setSecondDateValue(null);
                return;
            }

            // ✅ gültig → Dates setzen
            oDRS.setDateValue(rFrom.date);
            oDRS.setSecondDateValue(rTo.date);

            oDRS.setValueState(sap.ui.core.ValueState.None);
            oDRS.setValueStateText("");

            this.onAddFilter();
            this._closeDRSPopup(oDRS);
        },

        onFacturaDateParseError: function(oEvent) {
            var oDRS = oEvent.getSource();
            oDRS.setValueState(sap.ui.core.ValueState.Error);
            oDRS.setValueStateText("Invalid date format. Use dd.MM.yyyy - dd.MM.yyyy.");
        },

        //::::::::::::::::::::::::::::::::::::::::::::::::::::Allgemeine Funktionen für dieses View::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

        //Beim App-Verlassen löscht alle Abhängigkeiten/Cache
        onExit: function() {
            // 1) Binding detach (ValueHelp rebuild)
            if (this._oItemsBinding && this._fnItemsBindingChange) {
                this._oItemsBinding.detachChange(this._fnItemsBindingChange);
            }
            this._oItemsBinding = null;
            this._fnItemsBindingChange = null;

            // 2) Column header menus destroyen (pro Spalte geladene Fragmente)
            if (Array.isArray(this._aColumnMenus)) {
                this._aColumnMenus.forEach(function(oMenu) {
                    try {
                        oMenu && oMenu.destroy();
                    } catch (e) {}
                });
            }
            this._aColumnMenus = null;

            // 3) (Optional) gemeinsames Menu falls du es noch irgendwo lädst
            if (this._oColumnMenu) {
                try {
                    this._oColumnMenu.destroy();
                } catch (e) {}
            }
            this._oColumnMenu = null;

            // 4) ValueHelp Dialog clean-up
            if (this._oVHD) {
                try {
                    this._oVHD.destroy();
                } catch (e) {}
            }
            this._oVHD = null;

            if (this._oBasicSearchField) {
                try {
                    this._oBasicSearchField.destroy();
                } catch (e) {}
            }
            this._oBasicSearchField = null;

            // 6) Rest 
            this.oModel = null;
            this.oSmartVariantManagement = null;
            this.oExpandedLabel = null;
            this.oSnappedLabel = null;
            this.oFilterBar = null;
            this.oTable = null;
        },

        // Navigation zur Detailseite
        onInvoicePress: function(oEvent) {
            const oItem = oEvent.getParameter("listItem");
            const oCtx = oItem.getBindingContext("backend");

            if (!oCtx) {
                console.error("Kein BindingContext für Model 'backend' gefunden");
                return;
            }

            const sInvoiceId = oCtx.getProperty("MetaData/Object/Data/Basics/Number/Value");

            const oMainViewModel = this.getView().getModel("mainView");
            oMainViewModel.setProperty("/openDetailsOnMatch", true);
            oMainViewModel.setProperty("/layout", "TwoColumnsBeginExpanded");

            const oRouter = UIComponent.getRouterFor(this);
            oRouter.navTo("DetailsRoute", {
                invoiceId: sInvoiceId
            });
        },

    // ---------------------------------------------------
    // Löschen
    // ---------------------------------------------------
    onSelectionChange: function (oController, oEvent) {
      const oTable        = oEvent.getSource();
      const aSelected     = oTable.getSelectedItems();
      const oDeleteButton = oController.byId("btnDelete");

      if (oDeleteButton) {
        oDeleteButton.setEnabled(aSelected.length > 0);
      }
    },

    onDelete: function (oController) {
      const oTable         = oController.byId("tblBilling");
      const aSelectedItems = oTable.getSelectedItems();

      if (!aSelectedItems.length) {
        return;
      }

      MessageBox.confirm(
        `Do you really want to delete ${aSelectedItems.length} item(s)?`,
        {
          title: "Confirm Deletion",
          actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
          emphasizedAction: MessageBox.Action.DELETE,
          onClose: function (sAction) {
            if (sAction !== MessageBox.Action.DELETE) {
              return;
            }

            const oModel = oController.getOwnerComponent().getModel("backend");
            const aData  = oModel.getProperty("/value") || [];

            const aIndices = aSelectedItems.map(function (oItem) {
              const oCtx  = oItem.getBindingContext("backend");
              const sPath = oCtx.getPath(); // z.B. "/value/3"
              return parseInt(sPath.split("/").pop(), 10);
            });

            aIndices
              .sort(function (a, b) { return b - a; })
              .forEach(function (iIndex) {
                aData.splice(iIndex, 1);
              });

            oModel.setProperty("/value", aData);

            oTable.removeSelections(true);
            oController.byId("btnDelete").setEnabled(false);
          }
        }
      );
    },
    }, View1Helper ));
});

