/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["demo/app/demoapp/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
