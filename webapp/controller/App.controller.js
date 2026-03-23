sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], (BaseController, JSONModel) => {
  "use strict";

  return BaseController.extend("demo.app.demoapp.controller.App", {
    onInit() {

      const oViewModel = new JSONModel({
        layout: "OneColumn",
        openDetailsOnMatch: false
      });

      // Modell auf App-View setzen, wird zu Kind-Views (View1, Details) durchgereicht
      this.getView().setModel(oViewModel, "mainView");

    }
  });
});