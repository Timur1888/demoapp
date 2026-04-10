sap.ui.define([
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/Locale"
], function (NumberFormat, Locale) {
    "use strict";

    return {
        formatAbbreviations: function (sText) {
            if (!sText) {
                return "";
            }
            // alle bekannten CLARC-Prefixe
            return sText.replace(
                /^(ccIT_|ccCS_|ccBF_|ccDM_|ccDS_)/,
                ""
            );
        },
        // Icon je nach Wert
        formatDeliveryMethodIcon: function (sMethod) {
            switch (sMethod) {
                case "ccDM_Email": return "sap-icon://email";
                case "ccDM_PostalService": return "sap-icon://print";
                case "ccDM_EGatewayProvider": return "sap-icon://world";
                default: return "";
            }
        },

        // --- Formatter für TransferFormat ccBF_* -> * ---
        formatTransferFormat: function (sMethod) {
            if (!sMethod) { return ""; }
            return sMethod.replace(/^ccBF_/, "");
        },


        // --- Datum aus $date in lesbares Datum konvertieren ---
        formatDate: function (sDate) {
            if (!sDate) { return ""; }
            try {
                const oDate = new Date(sDate);
                return oDate.toLocaleDateString(); // z.B. 28.11.2025
            } catch (e) {
                return sDate;
            }
        },

        // --- PDF-Spalte ---
        formatPdf: function (sTransferFormat) {
            if (!sTransferFormat) { return ""; }
            return sTransferFormat.indexOf("PDF") !== -1 ? "Ja" : "Nein";
        },

        // --- Währungsformatierung 21.875,00 € ---
        formatCurrencyValue: function (vNumber) {
            if (vNumber == null) {
                return "";
            }

            var oLocale = new Locale("de-DE");
            var oFormatter = NumberFormat.getCurrencyInstance({
                currencyCode: false,
                showMeasure: true,
                maxFractionDigits: 2,
                minFractionDigits: 2
            }, oLocale);

            return oFormatter.format(vNumber, "EUR");
        },

        // ---------------------------------------------------
        // Status-Formatter
        // ---------------------------------------------------
        formatStatusIcon: function (sState) {
            switch (sState) {
                case "ccDS_Finished":
                    return "sap-icon://paper-plane";
                case "ccDS_UserAction":
                    return "sap-icon://action";
                case "ccDS_Error":
                    return "sap-icon://error";
                case "ccDS_Deleted":
                    return "sap-icon://decline";

                default:
                    return "sap-icon://question-mark";
            }
        },

        formatStatusState: function (sState) {
            switch (sState) {
                case "ccDS_Finished":
                    return sap.ui.core.ValueState.Success;

                case "ccDS_UserAction":
                    return sap.ui.core.ValueState.Warning;

                case "ccDS_Error":
                    return sap.ui.core.ValueState.Error;

                case "ccDS_Deleted":
                    return sap.ui.core.ValueState.Warning;

                default:
                    return sap.ui.core.ValueState.None;
            }
        },


        // ---------------------------------------------------
        // Delivery Mode-Formatter
        // ---------------------------------------------------
        formatDeliveryModeIcon: function (sDelMode) {
            switch (sDelMode) {
                case "ccDM_Unknown":
                    return "sap-icon://question-mark";
                case "ccDM_UserAction":
                    return "sap-icon://action";
                default:
                    return "sap-icon://question-mark";
            }
        },

        // --- Formatter für DeliveryMode ccDM_* -> * ---
        formatDeliveryModeState: function (sDelMethod) {
            switch (sDelMethod) {
                case "ccDS_Finished":
                    return sap.ui.core.ValueState.Success;
                case "ccDS_UserAction":
                    return sap.ui.core.ValueState.Warning;
                default:
                    return sap.ui.core.ValueState.None;
            };
        }
    };
});