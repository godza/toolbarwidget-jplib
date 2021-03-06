/**
 * (c) 2013 Rob W <gwnRob@gmail.com>
 * MIT license
 **/
/*globals require, exports, console*/
'use strict';
const winUtils = require('sdk/window/utils');
const { browserWindows } = require('sdk/windows');
const sstorage = require('simple-storage').storage;

const browserURL = 'chrome://browser/content/browser.xul';
const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * widgetID: A sdk/widget ID
 *
 * Returns: The ID of the corresponding <toolbarbutton> element.
 */
function getWidgetId(widgetId) {
  // This method is based on code in sdk/widget.js, look for setAttribute("id", id);

  // Temporary work around require("self") failing on unit-test execution ...
  let jetpackID = "testID";
  try {
    jetpackID = require("sdk/self").id;
  } catch(e) {}
  return "widget:" + jetpackID + "-" + widgetId;
}

// currentset manipulation methods
function getCurrentSet(toolbar) {
  let currentSet = toolbar.getAttribute('currentset') || toolbar.currentSet;
  currentSet = currentSet == '__empty' ? [] : currentSet.split(',');
  return currentSet;
}
function setCurrentSet(toolbar, /*array*/currentSet) {
  currentSet = currentSet.length ? currentSet.join(',') : '__empty';
  toolbar.setAttribute('currentset', currentSet);
  // Save position
  toolbar.ownerDocument.persist(toolbar.id, 'currentset');
}
// Usually, the state is persisted using XUL's currentset attribute.
// However, this state can be lost when the attribute is recalculated when the widget is not rendered yet,
// e.g. by other add-ons. When this happens, we try to reconstruct the currentset attribute using a cached
// version of the currentSet.
//
// Returns: true iff currentSet has been modified.
function putWidgetInCurrentSet(/*string*/widgetId, /*array*/currentSet, /*array*/cachedCurrentSet) {
  let index = cachedCurrentSet.indexOf(widgetId);
  if (~index) {
    // Found widget in cached set. Now try to find the closest existing toolbar item
    // in order to insert our widget.
    let isAfter = true;
    let prev = index;
    let next = index;
    while (prev >= 0 || next < cachedCurrentSet.length) {
      if (isAfter) {
        if (++next < cachedCurrentSet.length) {
          let i = currentSet.indexOf(cachedCurrentSet[next]);
          if (~i) {
            // Found an existing toolbar item that is located after the widgetId.
            // Put widget before this item.
            currentSet.splice(i, 0, widgetId);
            return true;
          }
        }
      } else {
        if (--prev >= 0) {
          let i = currentSet.indexOf(cachedCurrentSet[prev]);
          if (~i) {
            // Found an existing toolbar item that is located before the widgetId.
            // Put widget after this item.
            currentSet.splice(i + 1, 0, widgetId);
            return true;
          }
        }
      }
      isAfter = !isAfter;
    }
    // At this point, none of the siblings matched, but we did certainly know for sure
    // that the toolbarID is specified. So, just insert the widget at the end
    currentSet.push(widgetId);
    return true;
  }
  return false;
}

// Change the currentset attribute of a toolbar.
function moveWidgetToToolbar(config) {
  let { toolbarID, insertbefore, widgetId, toolbarWidgetId, forceMove, weakmap } = config;

  // Go through all windows, and set the currentset attribute of the <toolbar>
  // with ID toolbarID (unless a different toolbar has contains the widget,
  //   and forceMove is false)
  forEachBrowserWindow(function(window) {
    // Skip window if forceMove is false and it was already seen
    if (!forceMove && weakmap.has(window)) return;
    weakmap.set(window, '');

    for (let toolbar of window.document.getElementsByTagNameNS(NS_XUL, 'toolbar')) {
      let currentSet = getCurrentSet(toolbar);
      let index = currentSet.indexOf(widgetId);
      if (~index) { // Toolbar contains widget...
        if (toolbar.getAttribute('id') != toolbarID && forceMove) {
          currentSet.splice(index, 1);
          setCurrentSet(toolbar, currentSet);
          // Now put the widget on the desired toolbar
          saveWidgetToToolbar(window.document);
        }
        return;
      }
    }
    // Toolbar widget state not found in XUL. Perhaps some other extension deleted the
    // state. Let's check the add-on's storage, and use the saved state if it exists.
    // (provided that the addon developer did not set forceMove to true)
    let cachedWidgetState = sstorage._toolbarwidgetState && sstorage._toolbarwidgetState[toolbarWidgetId];
    if (cachedWidgetState && !forceMove) {
      let toolbar = window.document.getElementById(cachedWidgetState.toolbarID);
      if (toolbar) {
        // Toolbar's currentSet does not contain the widget, but the add-on's storage contains
        // an entry for this toolbar. Use the add-on's storage as fallback.
        let currentSet = getCurrentSet(toolbar);
        if (putWidgetInCurrentSet(widgetId, currentSet, cachedWidgetState.currentSet)) {
          setCurrentSet(toolbar, currentSet);
          return;
        }
      }
    }
    // Didn't find any toolbar matching the ID.
    saveWidgetToToolbar(window.document);
  });
  function saveWidgetToToolbar(document) {
    let toolbar = document.getElementById(toolbarID);
    // TODO: Remove console.error, or emit error events?
    if (!toolbar) {
      console.error('No toolbar found with ID "' + toolbarID + '"!');
      return;
    }
    if (!/^toolbar$/i.test(toolbar.tagName)) { // TODO: Is this check needed?
      console.error('Element with ID "' + toolbarID + '" is not a <toolbar>!');
      return;
    }
    let currentSet = getCurrentSet(toolbar);
    let index = -1;
    // Insert element before first found insertbefore, if specified.
    for (let beforeElementId of insertbefore) {
      if ((index = currentSet.indexOf(beforeElementId)) !== -1) {
        break;
      }
    }
    if (index !== -1) {
      currentSet.splice(index, 0, widgetId);
    } else {
      currentSet.push(widgetId);
    }
    setCurrentSet(toolbar, currentSet);
  }
}

// Ensures that all widgets has the following height
function setWidgetHeight(options, isToolbarheightReliable) {
  let { widgetId } = options;
  forEachBrowserWindow(function(window) {
    let widget = window.document.getElementById(widgetId);
    if (widget) {
      setXulWidgetHeight(widget, options, isToolbarheightReliable);
    }
  });
}

// add button class
function addButtonClass(options) {
  let { widgetId } = options;
  forEachBrowserWindow(function(window) {
    let widget = window.document.getElementById(widgetId);
    if (widget) {
      widget.setAttribute('class', 'toolbarbutton-1');
    }
  });
}

// set button badge
function setBadge(options) {
  let { widgetId } = options;
  forEachBrowserWindow(function(window) {
    let widget = window.document.getElementById(widgetId);
    if (widget) {
      setXulBadge(widget, options);
    }
  });
}

function forEachBrowserWindow(func) {
  // If you're on private browsing mode, winUtils.windows
  // Does not correctly give you all the private windows even if you've
  // selected the permissions so we will ensure that at least the current
  // window has the correct toolbar widget by building an array of windows
  // manually
  let currentWin = winUtils.getMostRecentBrowserWindow();
  if (currentWin && currentWin.location == browserURL) {
    func(currentWin);
  }
  for (let window of winUtils.windows()) {
    if (window !== null && window !== currentWin && window.location == browserURL) {
      func(window);
    }
  }
}

// boolean isToolbarheightReliable: When the buttons are rendered for the first time, the
// toolbar's height is assumed to be reliable, because all existing items will respect the user's
// height preference. When the height preference is changed, this value is not reliable any more
// because other buttons might still have the height of the old preference, so we fall back to
// hard-coded maximum values.
function setXulWidgetHeight(widget, options, isToolbarheightReliable) {
  let { height, autoShrink, aspectRatio } = options;
  let iframe = widget.querySelector('iframe');
  if (!iframe) return;
  // The height of the button depends on several implementation-defined factors:
  // - The widget's minHeight (widget.js: _createNode)
  // - The iframe's maxHeight (widget.js: fill)
  // - The iframe's height (widget.js: fill)

  // Decrease the lower bound if needed
  if (parseFloat(widget.style.minHeight) > height) {
    widget.style.minHeight = height + 'px';
  }
  // Shrink height when the container has a smaller height
  if (autoShrink) {
    let toolbar = widget.parentNode;
    if (toolbar.id.lastIndexOf('wrapper-', 0) === 0) {
      // Customization mode.
      toolbar = toolbar.parentNode;
    }
    let maxHeight;
    if (isToolbarheightReliable) {
      // Decrease content's height in order to detect the real height of the toolbar excluding the button
      iframe.style.maxHeight = widget.style.minHeight || '16px';
      let style = widget.ownerDocument.defaultView.getComputedStyle(toolbar);
      maxHeight = parseFloat(style.height) - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    } else {
      // When the toolbar's height is not reliable, use hard-coded values.
      // NOTE: These values are certainly correct for nav-bar. They might be incorrect for other toolbars.
      let iconsize = toolbar.getAttribute('iconsize');
      if (iconsize == 'small') {
        maxHeight = 19;
      } else if (iconsize == 'large') {
        maxHeight = 33;
      }
    }
    if (maxHeight > 0 && maxHeight < height) {
      height = maxHeight;
    }
  }
  iframe.style.height = height + 'px';
  iframe.style.maxHeight = height + 'px';

  if (aspectRatio) {
    let width = height / aspectRatio;
    iframe.style.width = width + 'px';
    if (parseFloat(widget.style.minWidth) > width) {
      widget.style.minWidth = width + 'px';
    }
  }
}

function validateHeight(height) {
  if (typeof height != 'number' || height < 0 || isNaN(height) || !isFinite(height)) {
    throw new Error('ToolbarWidget.height is not a number ' + height);
  }
  return true;
}
function validateAspectRatio(aspectRatio) {
  if (typeof aspectRatio != 'number' || aspectRatio < 0 || isNaN(aspectRatio) || !isFinite(aspectRatio)) {
    throw new Error('ToolbarWidget.aspectRatio should be a non-negative number. Got ' + aspectRatio);
  }
  return true;
}
// Set badge of xul element
function setXulBadge(widget, options) {
  let { height, autoShrink, aspectRatio } = options;
  let iframe = widget.querySelector('iframe');
  if (!iframe) return;

  var icon_url = options['iconURL'];
  if (iframe.contentWindow.retina || iframe.contentWindow.devicePixelRatio) {
    icon_url = options['iconRetinaURL'];
  } // if

  var badge_html = '';
  if (options['badge_value']) {
    badge_html = '<span style="font-size: 8px; font-weight: bold; position: absolute; bottom: 1px; right: 0px; padding: 0 3px; margin: 0; cursor: default;">' +
      '<span style="background-color: red; border-radius: 3px; position: absolute; left: 0px; right: 0px; top: 0px; bottom: 0px; opacity: 0.8"></span>' +
      '<span style="position: relative; color: white;">' + options['badge_value'] + '</span>' +
      '</span>';
  } // if

  var button_html = 'data:text/html,' +
    '<html style="margin:0; padding:0; height: 100%; width: 100%">' +
    '<body style="margin:0; padding:0; height: 100%; width: 100%; text-align: center; cursor: normal">' +
    '<div style="position: relative; ; cursor: normal">' +
    '<img src="' + icon_url + '" style="width: 19px; height: 19px; cursor: normal">' +
    badge_html +
    '</div>' +
    '</body>' +
    '</html>'

  iframe.setAttribute('src', button_html);
}

// Identical to sdk/widget, with one addition:
// - optional string toolbarID
// - optional string or array of strings insertbefore
// - optional boolean forceMove
// - optional number height
// - optional boolean autoShrink (default true)
// - optional number aspectRatio (default 0 = none)
exports.ToolbarWidget = function(options) {
  let config;
  if (options) {
    if ('height' in options) validateHeight(options.height);
    if ('aspectRatio' in options) validateAspectRatio(options.aspectRatio);

    options.contentURL = 'data:text/html,<html></html>';

    config = {
      height: options.height,
      autoShrink: options.autoShrink !== false,
      aspectRatio: +options.aspectRatio || 0,

      toolbarID: options.toolbarID,
      insertbefore: options.insertbefore || [],
      widgetId: getWidgetId(options.id), // ID of <toolbaritem> XUL element
      toolbarWidgetId: ''+options.id,
      forceMove: !!options.forceMove,
      iconURL: options.iconURL,
      iconRetinaURL: options.iconRetinaURL,
      weakmap: new WeakMap() // Used to request a movement only once if forceMove is false
    };

    if (!Array.isArray(config.insertbefore)) {
      config.insertbefore = [config.insertbefore];
    }
    if (config.toolbarID)
      moveWidgetToToolbar(config);
  }
  let sdkWidget = require('sdk/widget').Widget(options);
  if (config) {
    // Watch new windows and apply position
    if (config.toolbarID || config.height) {
      let destroyed = false;
      let onCustomizationChange = function() {
        if (destroyed) {
          return;
        }
        if (config.toolbarID) {
          // this = target of customizationchange = window
          let widget = this.document.getElementById(config.widgetId);
          if (widget) {
            let toolbar = widget.parentNode;
            if (toolbar.id.lastIndexOf('wrapper-', 0) === 0) {
              // Customization mode.
              toolbar = toolbar.parentNode;
            }
            if (!sstorage._toolbarwidgetState) {
              sstorage._toolbarwidgetState = {};
            }
            let currentSet = toolbar.currentSet;
            if (currentSet === '__empty') currentSet = getCurrentSet(toolbar);
            else currentSet = currentSet.split(',');
            currentSet = currentSet.map(function(id) {
              return id
                // Remove prefix of elements in customization mode
                .replace(/^wrapper-/, '')
                // Strip digits from special items (see CustomizableUI.jsm and test_toolbar.xul)
                .replace(/^(?:customizableui-special-)?(spring|spacer|separator)\d+/, '$1');
            });
            sstorage._toolbarwidgetState[config.toolbarWidgetId] = {
              toolbarID: toolbar.id,
              currentSet: currentSet
            };
          }
        }
        if (config.height && config.autoShrink) {
          setWidgetHeight(config, false);
        }

        addButtonClass(config);
      };
      forEachBrowserWindow(function(window) {
        window.addEventListener('customizationchange', onCustomizationChange);
      });
      let onNewWindow = function() {
        if (config.toolbarID)
          moveWidgetToToolbar(config);
        if (config.height)
          setWidgetHeight(config, true);

        addButtonClass(config);
        winUtils.getMostRecentBrowserWindow().addEventListener('customizationchange', onCustomizationChange);
      };
      browserWindows.on('open', onNewWindow);
      if (config.height)
        setWidgetHeight(config, true);

      addButtonClass(config);

      let destroy = sdkWidget.destroy;
      sdkWidget.destroy = function toolbarWidgetDestructor() {
        if (destroyed) return;
        destroyed = true;
        browserWindows.removeListener('open', onNewWindow);
        forEachBrowserWindow(function(window) {
          window.removeEventListener('customizationchange', onCustomizationChange);
        });
        return destroy.call(this);
      };
      require('sdk/system/unload').ensure(sdkWidget, 'destroy');
    }

    // Add extra properties to returned object
    Object.defineProperties(sdkWidget, {
      toolbarID: {
        get: function() config.toolbarID,
        enumerable: true
      },
      insertbefore: {
        get: function() config.insertbefore.slice(),
        enumerable: true
      },
      forceMove: {
        get: function() config.forceMove,
        set: function(val) config.forceMove = !!val,
        enumerable: true
      },
      height: {
        get: function() config.height,
        set: function(val) {
          if (validateHeight(val)) {
            config.height = val;
            setWidgetHeight(config, false);
          }
        },
        enumerable: true
      },
      badge : {
        get : function () {
          return config.badge_value;
        },
        set : function (val) {
          config.badge_value = val;
          setBadge(config);
        },
        enumerable: true
      }
    });

    setBadge(config);
  }
  return sdkWidget;
};
// For testing purposes, define a hidden property:
Object.defineProperty(exports, 'getWidgetId', {
  get: function() getWidgetId
});
