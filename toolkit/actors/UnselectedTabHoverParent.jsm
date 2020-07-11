/* vim: set ts=2 sw=2 sts=2 et tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var EXPORTED_SYMBOLS = ["UnselectedTabHoverParent"];

class UnselectedTabHoverParent extends JSWindowActorParent {
  receiveMessage(message) {
    const topBrowsingContext = this.manager.browsingContext.top;
    const browser = topBrowsingContext.embedderElement;
    if (!browser) {
      return;
    }
    browser.shouldHandleUnselectedTabHover = message.data.enable;
  }
}