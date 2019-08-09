import EventEmitter from '../utils/EventEmitter'
import ConfigMinifier from '../utils/ConfigMinifier'
import {
    fnBind,
    getUniqueId,
} from '../utils/utils'

/**
 * Pops a content item out into a new browser window.
 * This is achieved by
 *
 *    - Creating a new configuration with the content item as root element
 *    - Serializing and minifying the configuration
 *    - Opening the current window's URL with the configuration as a GET parameter
 *    - GoldenLayout when opened in the new window will look for the GET parameter
 *      and use it instead of the provided configuration
 *
 * @param {Object} config GoldenLayout item config
 * @param {Object} dimensions A map with width, height, top and left
 * @param {String} parentId The id of the element the item will be appended to on popIn
 * @param {Number} indexInParent The position of this element within its parent
 * @param {lm.LayoutManager} layoutManager
 */


export default class BrowserPopout extends EventEmitter {
    constructor(config, dimensions, parentId, indexInParent, layoutManager) {

        super();
        
        this.isInitialised = false;

        this._config = config;
        this._dimensions = dimensions;
        this._parentId = parentId;
        this._indexInParent = indexInParent;
        this._layoutManager = layoutManager;
        this._popoutWindow = null;
        this._id = null;
        this._createWindow();
    }

    toConfig() {
        if (this.isInitialised === false) {
            throw new Error('Can\'t create config, layout not yet initialised');
        }
        return {
            dimensions: {
                width: this.getGlInstance().width,
                height: this.getGlInstance().height,
                left: this._popoutWindow.screenX || this._popoutWindow.screenLeft,
                top: this._popoutWindow.screenY || this._popoutWindow.screenTop
            },
            content: this.getGlInstance().toConfig().content,
            parentId: this._parentId,
            indexInParent: this._indexInParent
        };
    }

    getGlInstance() {
        return this._popoutWindow.__glInstance;
    }

    getWindow() {
        return this._popoutWindow;
    }

    close() {
        if (this.getGlInstance()) {
            this.getGlInstance()._$closeWindow();
        } else {
            try {
                this.getWindow().close();
            } catch (e) {
                //
            }
        }
    }

    /**
     * Returns the popped out item to its original position. If the original
     * parent isn't available anymore it falls back to the layout's topmost element
     */
    popIn() {
		
		var childConfig,
			parentItem,
			index = this._indexInParent;
		let content;
		let childId;
		let cachedNodes = this._layoutManager.cachedNodes;
		let indexSplice = 0;

		if( this._parentId ) {

			/*
			 * The $.extend call seems a bit pointless, but it's crucial to
			 * copy the config returned by this.getGlInstance().toConfig()
			 * onto a new object. Internet Explorer keeps the references
			 * to objects on the child window, resulting in the following error
			 * once the child window is closed:
			 *
			 * The callee (server [not server application]) is not available and disappeared
			 */
			childConfig = $.extend( true, {}, this.getGlInstance().toConfig() ).content[ 0 ];
			parentItem = this._layoutManager.root.getItemsById( this._parentId )[ 0 ];

			/*
			 * Fallback if parentItem is not available. Either add it to the topmost
			 * item or make it the topmost item if the layout is empty
			 */

			// If it turns out that the id is held in the cachedNodes array, then our parent is available to use in this array we just have to wire it back into the contentItem;
			if(!parentItem) {
				for(let i = 0; i < this._layoutManager.cachedNodes.nodes.length; i++) {

					if(this._parentId === this._layoutManager.cachedNodes.nodes[i].config.id) {
						content = this._layoutManager.cachedNodes.nodes[i];
						childId = this._layoutManager.cachedNodes.childIds[i];
						indexSplice = i;
						
					}
				}
				
				// Now we have the contentItem so traverse the tree to find the parent that shares the same contentItem, we use the id to do this as opposed to keep the reference, and then later wiring them together
				let mainTreeElem = this.findContentItemParam(this._layoutManager.root, childId, "id"); // This will return a reference to the contentItem from the main tree
				let mainTreeItem = null;
				// If mainTreeElem returns then there is a valid shared content item, otherwise mainTreeItem will stay at node and we add to root
				if(mainTreeElem) {
					mainTreeItem = mainTreeElem.parent;
				}

				let itemToReplace;
				if(mainTreeItem) {
					itemToReplace = this.matchChildNodes(mainTreeItem.element[0], cachedNodes.elements[cachedNodes.elements.length - 1]);
				
				let indexOfSharedContentItem;
				for(let i = 0; i < mainTreeItem.contentItems.length; i++) {
					// Check to see if they share the same child, if they do then we wire the component from the cachedNodes into the main tree
					if(mainTreeItem.contentItems[i].config.id === childId) {

						// Change the reference of the shared child to have its parent point to our content Item
						mainTreeItem.contentItems[i].parent = content;

						// Let the content hold a reference to the now restored childNode
						content.contentItems[content.contentItems.length] = mainTreeItem.contentItems[i];

						indexOfSharedContentItem = i;

						// Content Item was set on replaceChild, now we are reinstating another component, so if the current active tab is the previous one that was made on replaceChild we now update it to reflect the one we are reinstating -- so we reinstate that contentItem before we wire it back into the content Items
						if(mainTreeItem.isStack)
							if(mainTreeItem.header.tabs[indexOfSharedContentItem].contentItem == mainTreeItem.contentItems[indexOfSharedContentItem])
								mainTreeItem.header.tabs[indexOfSharedContentItem].contentItem = content;
	
						// Then wire it back into the tree
						mainTreeItem.contentItems[i] = content;
						content.parent = mainTreeItem;

						
					}
				}
	
				parentItem = content;
				
				// Replacing the child Nodes with the parentItem, this is the component that was stored in our cachedNodes we want to reinstate
				itemToReplace.parentNode.replaceChild(parentItem.element[0], itemToReplace);
				// Now that we've reinstated the parentItem we append to it the common child element that we have access to in our cachedNodes element

				// This same element we are appending is the element we just replaced above
				parentItem.element[0].append(this._layoutManager.cachedNodes.elements[this._layoutManager.cachedNodes.elements.length - 1]);

				} else {
					parentItem = this._layoutManager.root.contentItems[ 0 ];

				}
			}
		}

		// Remove from the cachedNodes
		this._layoutManager.cachedNodes.nodes.splice(indexSplice, 1);
		this._layoutManager.cachedNodes.childIds.splice(indexSplice, 1)
		this._layoutManager.cachedNodes.elements.splice(cachedNodes.elements.length-1, 1);

		parentItem.addChild( childConfig, this._indexInParent );

	
		this.close();
    }
    
    /**
	 * Want to compare the element, and if not equal traverse further down to childNodes
	 */
	matchChildNodes(rootElement, element) {
		if(rootElement === element) {
			return rootElement
		}
		for(let i = 0; i < rootElement.childNodes.length; i++) {
			rootElement = this.matchChildNodes(rootElement.childNodes[i], element);
			if(rootElement === element) {
				return rootElement;
			}
		}

		return rootElement.parentNode;
	}

	findContentItemParam(root, contentItemParam, param) {
		if(root.config[param] === contentItemParam) {
			return root;
		}
		for(let i = 0; i < root.contentItems.length; i++) {
			root = this.findContentItemParam(root.contentItems[i], contentItemParam, param);
			if(root.config[param] == contentItemParam) {
				return root;
			}
		}
		// If it's not the contentItem and doesn't have anymore contentItems, traverses back up
		return root.parent;

	}

    /**
     * Creates the URL and window parameter
     * and opens a new window
     *
     * @private
     *
     * @returns {void}
     */
    _createWindow() {
        var checkReadyInterval,
            url = this._createUrl(),

            /**
             * Bogus title to prevent re-usage of existing window with the
             * same title. The actual title will be set by the new window's
             * GoldenLayout instance if it detects that it is in subWindowMode
             */
            title = Math.floor(Math.random() * 1000000).toString(36),

            /**
             * The options as used in the window.open string
             */
            options = this._serializeWindowOptions({
                width: this._dimensions.width,
                height: this._dimensions.height,
                innerWidth: this._dimensions.width,
                innerHeight: this._dimensions.height,
                menubar: 'no',
                toolbar: 'no',
                location: 'no',
                personalbar: 'no',
                resizable: 'yes',
                scrollbars: 'no',
                status: 'no'
            });

        this._popoutWindow = window.open(url, title, options);

        if (!this._popoutWindow) {
            if (this._layoutManager.config.settings.blockedPopoutsThrowError === true) {
                var error = new Error('Popout blocked');
                error.type = 'popoutBlocked';
                throw error;
            } else {
                return;
            }
        }

        $(this._popoutWindow)
            .on('load', fnBind(this._positionWindow, this))
            .on('unload beforeunload', fnBind(this._onClose, this));

        /**
         * Polling the childwindow to find out if GoldenLayout has been initialised
         * doesn't seem optimal, but the alternatives - adding a callback to the parent
         * window or raising an event on the window object - both would introduce knowledge
         * about the parent to the child window which we'd rather avoid
         */
        checkReadyInterval = setInterval(fnBind(function() {
            if (this._popoutWindow.__glInstance && this._popoutWindow.__glInstance.isInitialised) {
                this._onInitialised();
                clearInterval(checkReadyInterval);
            }
        }, this), 10);
    }

    /**
     * Serialises a map of key:values to a window options string
     *
     * @param   {Object} windowOptions
     *
     * @returns {String} serialised window options
     */
    _serializeWindowOptions(windowOptions) {
        var windowOptionsString = [],
            key;

        for (key in windowOptions) {
            windowOptionsString.push(key + '=' + windowOptions[key]);
        }

        return windowOptionsString.join(',');
    }

    /**
     * Creates the URL for the new window, including the
     * config GET parameter
     *
     * @returns {String} URL
     */
    _createUrl() {
        var config = {
                content: this._config
            },
            storageKey = 'gl-window-config-' + getUniqueId(),
            urlParts;

        config = (new ConfigMinifier()).minifyConfig(config);

        try {
            localStorage.setItem(storageKey, JSON.stringify(config));
        } catch (e) {
            throw new Error('Error while writing to localStorage ' + e.toString());
        }

        urlParts = document.location.href.split('?');

        // URL doesn't contain GET-parameters
        if (urlParts.length === 1) {
            return urlParts[0] + '?gl-window=' + storageKey;

            // URL contains GET-parameters
        } else {
            return document.location.href + '&gl-window=' + storageKey;
        }
    }

    /**
     * Move the newly created window roughly to
     * where the component used to be.
     *
     * @private
     *
     * @returns {void}
     */
    _positionWindow() {
        this._popoutWindow.moveTo(this._dimensions.left, this._dimensions.top);
        this._popoutWindow.focus();
    }

    /**
     * Callback when the new window is opened and the GoldenLayout instance
     * within it is initialised
     *
     * @returns {void}
     */
    _onInitialised() {
        this.isInitialised = true;
        this.getGlInstance().on('popIn', this.popIn, this);
        this.emit('initialised');
    }

    /**
     * Invoked 50ms after the window unload event
     *
     * @private
     *
     * @returns {void}
     */
    _onClose() {
        setTimeout(fnBind(this.emit, this, ['closed']), 50);
    }
}
