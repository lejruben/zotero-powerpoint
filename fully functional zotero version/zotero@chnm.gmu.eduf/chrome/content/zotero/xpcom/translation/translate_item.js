/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2012 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Zotero.Translate.ItemSaver = function(libraryID, attachmentMode, forceTagType, document,
		cookieSandbox, baseURI) {
	// initialize constants
	this.newItems = [];
	this.newCollections = [];
	this._IDMap = {};
	
	// determine library ID
	if(libraryID === false) {
		this._libraryID = false;
	} else if(libraryID === true || libraryID == undefined) {
		this._libraryID = null;
	} else {
		this._libraryID = libraryID;
	}
	
	// determine whether to save files and attachments
	if (attachmentMode == Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD) {
		this._saveAttachment = this._saveAttachmentDownload;
	} else if(attachmentMode == Zotero.Translate.ItemSaver.ATTACHMENT_MODE_FILE) {
		this._saveAttachment = this._saveAttachmentFile;
	} else {
		this._saveAttachment = function() {};
	}
	
	this._saveFiles = !(attachmentMode === 0);
	
	// If group filesEditable==false, don't save attachments
	if (typeof this._libraryID == 'number') {
		var type = Zotero.Libraries.getType(this._libraryID);
		switch (type) {
			case 'group':
				var groupID = Zotero.Groups.getGroupIDFromLibraryID(this._libraryID);
				var group = Zotero.Groups.get(groupID);
				if (!group.filesEditable) {
					this._saveFiles = false;
				}
				break;
		}
	}
	
	// force tag types if requested
	this._forceTagType = forceTagType;
	// to set cookies on downloaded files
	this._cookieSandbox = cookieSandbox;
	
	// the URI to which other URIs are assumed to be relative
	if(typeof baseURI === "object" && baseURI instanceof Components.interfaces.nsIURI) {
		this._baseURI = baseURI;
	} else {
		// try to convert to a URI
		this._baseURI = null;
		try {
			this._baseURI = Components.classes["@mozilla.org/network/io-service;1"].
				getService(Components.interfaces.nsIIOService).newURI(baseURI, null, null);
		} catch(e) {};
	}
};

Zotero.Translate.ItemSaver.ATTACHMENT_MODE_IGNORE = 0;
Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD = 1;
Zotero.Translate.ItemSaver.ATTACHMENT_MODE_FILE = 2;

Zotero.Translate.ItemSaver.prototype = {
	/**
	 * Saves items to Standalone or the server
	 * @param items Items in Zotero.Item.toArray() format
	 * @param {Function} callback A callback to be executed when saving is complete. If saving
	 *    succeeded, this callback will be passed true as the first argument and a list of items
	 *    saved as the second. If saving failed, the callback will be passed false as the first
	 *    argument and an error object as the second
	 * @param {Function} [attachmentCallback] A callback that receives information about attachment
	 *     save progress. The callback will be called as attachmentCallback(attachment, false, error)
	 *     on failure or attachmentCallback(attachment, progressPercent) periodically during saving.
	 */
	"saveItems":function(items, callback, attachmentCallback) {
		// if no open transaction, open a transaction and add a timer call to close it
		var openedTransaction = false;
		if(!Zotero.DB.transactionInProgress()) {
			Zotero.DB.beginTransaction();
			openedTransaction = true;
		}
		
		try {
			var newItems = [];
			for each(var item in items) {
				// Get typeID, defaulting to "webpage"
				var newItem;
				var type = (item.itemType ? item.itemType : "webpage");
				
				if(type == "note") {			// handle notes differently
					newItem = new Zotero.Item('note');
					newItem.libraryID = this._libraryID;
					if(item.note) newItem.setNote(item.note);
					var myID = newItem.save();
					newItem = Zotero.Items.get(myID);
				} else {
					if(type == "attachment") {	// handle attachments differently
						newItem = this._saveAttachment(item, null, attachmentCallback);
						if(!newItem) continue;
						var myID = newItem.id;
					} else {
						var typeID = Zotero.ItemTypes.getID(type);
						newItem = new Zotero.Item(typeID);
						newItem._libraryID = this._libraryID;
					
						this._saveFields(item, newItem);
						
						// handle creators
						if(item.creators) {
							this._saveCreators(item, newItem);
						}
						
						// save item
						var myID = newItem.save();
						newItem = Zotero.Items.get(myID);
						
						// handle notes
						if(item.notes) {
							this._saveNotes(item, myID);
						}
					
						// handle attachments
						if(item.attachments) {
							for(var i=0; i<item.attachments.length; i++) {
								var newAttachment = this._saveAttachment(item.attachments[i], myID, attachmentCallback);
								if(typeof newAttachment === "object") {
									this._saveTags(item.attachments[i], newAttachment);
								}
							}
						}
					}
				}
				
				if(item.itemID) this._IDMap[item.itemID] = myID;
				
				// handle see also
				this._saveTags(item, newItem);
				
				// add to new item list
				newItem = Zotero.Items.get(myID);
				newItems.push(newItem);
			}
			
			if(openedTransaction) Zotero.DB.commitTransaction();
			callback(true, newItems);
		} catch(e) {
			if(openedTransaction) Zotero.DB.rollbackTransaction();
			callback(false, e);
		}
	},
	
	"saveCollection":function(collection) {
		var collectionsToProcess = [collection];
		var parentIDs = [null];
		var topLevelCollection;
		
		while(collectionsToProcess.length) {
			var collection = collectionsToProcess.shift();
			var parentID = parentIDs.shift();
			
			var newCollection = Zotero.Collections.add(collection.name, parentID);
			if(parentID === null) topLevelCollection = newCollection;
			
			this.newCollections.push(newCollection.id);
			
			var toAdd = [];
			
			for(var i=0; i<collection.children.length; i++) {
				var child = collection.children[i];
				if(child.type === "collection") {
					// do recursive processing of collections
					collectionsToProcess.push(child);
					parentIDs.push(newCollection.id);
				} else {
					// add mapped items to collection
					if(this._IDMap[child.id]) {
						toAdd.push(this._IDMap[child.id]);
					} else {
						Zotero.debug("Translate: Could not map "+child.id+" to an imported item", 2);
					}
				}
			}
			
			if(toAdd.length) {
				Zotero.debug("Translate: Adding " + toAdd, 5);
				newCollection.addItems(toAdd);
			}
		}
		
		return topLevelCollection;
	},
	
	"_saveAttachmentFile":function(attachment, parentID, attachmentCallback) {
		Zotero.debug("Translate: Adding attachment", 4);
			
		if(!attachment.url && !attachment.path) {
			let e = "Translate: Ignoring attachment: no path or URL specified";
			Zotero.debug(e, 2);
			attachmentCallback(attachment, false, e);
			return false;
		}
		
		let done = false;
		if (attachment.path) {
			var file = this._parsePath(attachment.path);
			if(!file) {
				let asUrl = Zotero.Attachments.cleanAttachmentURI(attachment.path);
				if (!attachment.url && !asUrl) {
					let e = "Translate: Could not parse attachment path <" + attachment.path + ">";
					Zotero.debug(e, 2);
					attachmentCallback(attachment, false, e);
					return false;
				} else if (!attachment.url && asUrl) {
					Zotero.debug("Translate: attachment path looks like a URI: " + attachment.path);
					attachment.url = asUrl;
					delete attachment.path;
				}
			} else {
				if (attachment.url) {
					attachment.linkMode = "imported_url";
					var myID = Zotero.Attachments.importSnapshotFromFile(file,
						attachment.url, attachment.title, attachment.mimeType, attachment.charset,
						parentID);
				}
				else {
					attachment.linkMode = "imported_file";
					var myID = Zotero.Attachments.importFromFile(file, parentID);
				}
				attachmentCallback(attachment, 100);
				done = true;
			}
		}
		
		if(!done) {
			let url = Zotero.Attachments.cleanAttachmentURI(attachment.url);
			if (!url) {
				let e = "Translate: Invalid attachment.url specified <" + attachment.url + ">";
				Zotero.debug(e, 2);
				attachmentCallback(attachment, false, e);
				return false;
			}
			
			attachment.url = url;
			url = Components.classes["@mozilla.org/network/io-service;1"]
				.getService(Components.interfaces.nsIIOService)
				.newURI(url, null, null); // This cannot fail, since we check above
			
			// see if this is actually a file URL
			if(url.scheme == "file") {
				let e = "Translate: Local file attachments cannot be specified in attachment.url";
				Zotero.debug(e, 2);
				attachmentCallback(attachment, false, e);
				return false;
			} else if(url.scheme != "http" && url.scheme != "https") {
				let e = "Translate: " + url.scheme + " protocol is not allowed for attachments from translators.";
				Zotero.debug(e, 2);
				attachmentCallback(attachment, false, e);
				return false;
			}
			
			// At this point, must be a valid HTTP/HTTPS url
			attachment.linkMode = "linked_file";
			try {
				var myID = Zotero.Attachments.linkFromURL(attachment.url, parentID,
						(attachment.mimeType ? attachment.mimeType : undefined),
						(attachment.title ? attachment.title : undefined));
			} catch(e) {
				Zotero.debug("Translate: Error adding attachment "+attachment.url, 2);
				attachmentCallback(attachment, false, e);
				return false;
			}
			Zotero.debug("Translate: Created attachment; id is "+myID, 4);
			attachmentCallback(attachment, 100);
		}
		
		var newItem = Zotero.Items.get(myID);
		
		// save fields
		attachment.itemType = "attachment";
		this._saveFields(attachment, newItem);
		
		// add note if necessary
		if(attachment.note) {
			newItem.setNote(attachment.note);
		}
		
		newItem.save();
		
		return newItem;
	},

	"_parsePathURI":function(path) {
		try {
			var uri = Services.io.newURI(path, "", this._baseURI);
			var file = uri.QueryInterface(Components.interfaces.nsIFileURL).file;
			if(file.path != '/' && file.exists()) return file;
		}
		catch (e) {
			Zotero.logError(e);
		}
		return false;
	},

	"_parseAbsolutePath":function(path) {
		try {
			// First, try to parse absolute paths using initWithPath
			var file = Components.classes["@mozilla.org/file/local;1"].
				createInstance(Components.interfaces.nsILocalFile);
			file.initWithPath(path);
			if(file.exists()) return file;
		} catch(e) {
			Zotero.logError(e);
		}
		return false;
	},

	"_parseRelativePath":function(path) {
		try {
			var file = this._baseURI.QueryInterface(Components.interfaces.nsIFileURL).file.parent;
			var splitPath = path.split(/\//g);
			for(var i=0; i<splitPath.length; i++) {
				if(splitPath[i] !== "") file.append(splitPath[i]);
			}
			if(file.exists()) return file;
		} catch(e) {
			Zotero.logError(e);
		}
		return false;
	},

	"_parsePath":function(path) {
		var file;

		// First, try to parse as absolute path
		if((/^[a-zA-Z]:[\\\/]|^\\\\/.test(path) && Zotero.isWin) // Paths starting with drive letter or network shares starting with \\
			|| (path[0] === "/" && !Zotero.isWin)) {
			// Forward slashes on Windows are not allowed in filenames, so we can
			// assume they're meant to be backslashes. Backslashes are technically
			// allowed on Linux, so the reverse cannot be done reliably.
			var nativePath = Zotero.isWin ? path.replace('/', '\\', 'g') : path;
			if (file = this._parseAbsolutePath(nativePath)) {
				Zotero.debug("Translate: Got file "+nativePath+" as absolute path");
				return file;
			}
		}

		// Next, try to parse as URI
		if((file = this._parsePathURI(path))) {
			Zotero.debug("Translate: Got "+path+" as URI")
			return file;
		} else if(path.substr(0, 7) !== "file://") {
			// If it was a fully qualified file URI, we can give up now

			// Next, try to parse as relative path, replacing backslashes with slashes
			if((file = this._parseRelativePath(path.replace(/\\/g, "/")))) {
				Zotero.debug("Translate: Got file "+path+" as relative path");
				return file;
			}

			// Next, try to parse as relative path, without replacing backslashes with slashes
			if((file = this._parseRelativePath(path))) {
				Zotero.debug("Translate: Got file "+path+" as relative path");
				return file;
			}

			if(path[0] !== "/") {
				// Next, try to parse a path with no / as an absolute URI or path
				if((file = this._parsePathURI("/"+path))) {
					Zotero.debug("Translate: Got file "+path+" as broken URI");
					return file;
				}

				if((file = this._parseAbsolutePath("/"+path))) {
					Zotero.debug("Translate: Got file "+path+" as broken absolute path");
					return file;
				}

			}
		}

		// Give up
		Zotero.debug("Translate: Could not find file "+path)

		return false;
	},
	
	"_saveAttachmentDownload":function(attachment, parentID, attachmentCallback) {
		Zotero.debug("Translate: Adding attachment", 4);
		
		if(!attachment.url && !attachment.document) {
			Zotero.debug("Translate: Not adding attachment: no URL specified", 2);
		} else {
			// Determine whether to save an attachment
			if(attachment.snapshot !== false) {
				if(attachment.document
						|| (attachment.mimeType &&
							(attachment.mimeType === "text/html"
							 || attachment.mimeType == "application/xhtml+xml"))) {
					if(!Zotero.Prefs.get("automaticSnapshots")) return;
				} else {
					if(!Zotero.Prefs.get("downloadAssociatedFiles")) return;
				}
			}
			
			var doc = undefined;
			if(attachment.document) {
				doc = new XPCNativeWrapper(Zotero.Translate.DOMWrapper.unwrap(attachment.document));
				if(!attachment.title) attachment.title = doc.title;
			}
			var title = attachment.title || null;
			if(!title) {
				// If no title provided, use "Attachment" as title for progress UI (but not for item)
				attachment.title = Zotero.getString("itemTypes.attachment");
			}
			
			if(attachment.snapshot === false || !this._saveFiles) {
				// if snapshot is explicitly set to false, attach as link
				attachment.linkMode = "linked_url";
				let url, mimeType;
				if(doc) {
					url = doc.location.href;
					mimeType = attachment.mimeType ? attachment.mimeType : doc.contentType;
				} else {
					url = attachment.url
					mimeType = attachment.mimeType ? attachment.mimeType : undefined;
				}
				
				let cleanURI = Zotero.Attachments.cleanAttachmentURI(url);
				if (!cleanURI) {
					let e = "Translate: Invalid attachment URL specified <" + url + ">";
					Zotero.debug(e, 2);
					attachmentCallback(attachment, false, e);
					return false;
				}
				url = Components.classes["@mozilla.org/network/io-service;1"]
					.getService(Components.interfaces.nsIIOService)
					.newURI(cleanURI, null, null); // This cannot fail, since we check above
				
				// Only HTTP/HTTPS links are allowed
				if(url.scheme != "http" && url.scheme != "https") {
					let e = "Translate: " + url.scheme + " protocol is not allowed for attachments from translators.";
					Zotero.debug(e, 2);
					attachmentCallback(attachment, false, e);
					return false;
				}
				
				try {
					Zotero.Attachments.linkFromURL(cleanURI, parentID, mimeType, title);
					attachmentCallback(attachment, 100);
				} catch(e) {
					Zotero.debug("Translate: Error adding attachment "+attachment.url, 2);
					attachmentCallback(attachment, false, e);
					return false;
				}
				return true;
			} else {
				// if snapshot is not explicitly set to false, retrieve snapshot
				if(doc) {
					try {
						attachment.linkMode = "imported_url";
						Zotero.Attachments.importFromDocument(doc,
							parentID, title, null, function(status, err) {
								if(status) {
									attachmentCallback(attachment, 100);
								} else {
									attachmentCallback(attachment, false, err);
								}
							}, this._libraryID);
						attachmentCallback(attachment, 0);
					} catch(e) {
						Zotero.debug("Translate: Error attaching document", 2);
						attachmentCallback(attachment, false, e);
					}
					return true;
				// Save attachment if snapshot pref enabled or not HTML
				// (in which case downloadAssociatedFiles applies)
				} else {
					var mimeType = (attachment.mimeType ? attachment.mimeType : null);
					var fileBaseName = Zotero.Attachments.getFileBaseNameFromItem(parentID);
					try {
						Zotero.debug('Importing attachment from URL');
						attachment.linkMode = "imported_url";
						Zotero.Attachments.importFromURL(attachment.url, parentID, title,
							fileBaseName, null, mimeType, this._libraryID, function(status, err) {
								// TODO: actually indicate progress during download
								if(status) {
									attachmentCallback(attachment, 100);
								} else {
									attachmentCallback(attachment, false, err);
								}
							}, this._cookieSandbox);
						attachmentCallback(attachment, 0);
					} catch(e) {
						Zotero.debug("Translate: Error adding attachment "+attachment.url, 2);
						attachmentCallback(attachment, false, e);
					}
					return true;
				}
			}
		}
		
		return false;
	},
	
	"_saveFields":function(item, newItem) {
		// fields that should be handled differently
		const skipFields = ["note", "notes", "itemID", "attachments", "tags", "seeAlso",
							"itemType", "complete", "creators"];
		
		var typeID = Zotero.ItemTypes.getID(item.itemType);
		var fieldID;
		for(var field in item) {
			// loop through item fields
			if(item[field] && skipFields.indexOf(field) === -1 && (fieldID = Zotero.ItemFields.getID(field))) {
				// if field is in db and shouldn't be skipped
				
				// try to map from base field
				if(Zotero.ItemFields.isBaseField(fieldID)) {
					fieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, fieldID);
					
					// Skip mapping if item field already exists
					var fieldName = Zotero.ItemFields.getName(fieldID);
					if(fieldName !== field && item[fieldName]) continue;
					
					if(fieldID) {
						Zotero.debug("Translate: Mapping "+field+" to "+fieldName, 5);	
					}
				}
				
				// if field is valid for this type, set field
				if(fieldID && Zotero.ItemFields.isValidForType(fieldID, typeID)) {
					newItem.setField(fieldID, item[field]);
				} else {
					Zotero.debug("Translate: Discarded field "+field+" for item: field not valid for type "+item.itemType, 3);
				}
			}
		}
	},
	
	"_saveCreators":function(item, newItem) {
		var creatorIndex = 0;
		for(var i=0; i<item.creators.length; i++) {
			var creator = item.creators[i];
			
			if(!creator.firstName && !creator.lastName) {
				Zotero.debug("Translate: Silently dropping empty creator");
				continue;
			}
			
			// try to assign correct creator type
			var creatorTypeID = 1;
			if(creator.creatorType) {
				try {
					var creatorTypeID = Zotero.CreatorTypes.getID(creator.creatorType);
				} catch(e) {
					Zotero.debug("Translate: Invalid creator type "+creator.creatorType+" for creator index "+j, 2);
				}
			}
			
			// Single-field mode
			if (creator.fieldMode && creator.fieldMode == 1) {
				var fields = {
					lastName: creator.lastName,
					fieldMode: 1
				};
			}
			// Two-field mode
			else {
				var fields = {
					firstName: creator.firstName,
					lastName: creator.lastName
				};
			}
			
			var creator = null;
			var creatorDataID = Zotero.Creators.getDataID(fields);
			if(creatorDataID) {
				var linkedCreators = Zotero.Creators.getCreatorsWithData(creatorDataID, this._libraryID);
				if (linkedCreators) {
					// TODO: support identical creators via popup? ugh...
					var creatorID = linkedCreators[0];
					creator = Zotero.Creators.get(creatorID);
				}
			}
			if(!creator) {
				creator = new Zotero.Creator;
				creator.libraryID = this._libraryID;
				creator.setFields(fields);
				var creatorID = creator.save();
			}
			
			newItem.setCreator(creatorIndex++, creator, creatorTypeID);
		}
	},
	
	"_saveNotes":function(item, parentID) {
		for(var i=0; i<item.notes.length; i++) {
			var note = item.notes[i];
			if(!note) continue;
			var myNote = new Zotero.Item('note');
			myNote.libraryID = this._libraryID;
			myNote.setNote(typeof note == "object" ? note.note : note);
			if(parentID) {
				myNote.setSource(parentID);
			}
			var noteID = myNote.save();
			
			if(typeof note == "object") {
				// handle see also
				myNote = Zotero.Items.get(noteID);
				this._saveTags(note, myNote);
			}
		}
	},
	
	"_saveTags":function(item, newItem) {
		// add to ID map
		if(item.itemID) {
			this._IDMap[item.itemID] = newItem.id;
		}
		
		// add see alsos
		if(item.seeAlso) {
			for(var i=0; i<item.seeAlso.length; i++) {
				var seeAlso = item.seeAlso[i];
				if(this._IDMap[seeAlso]) {
					newItem.addRelatedItem(this._IDMap[seeAlso]);
				}
			}
			newItem.save();
		}
		
		// if all tags are automatic and automatic tags pref is on, return immediately
		var tagPref = Zotero.Prefs.get("automaticTags");
		if(this._forceTagType == 1 && !tagPref) return;
		
		// add tags
		if(item.tags) {
			var tagsToAdd = {};
			tagsToAdd[0] = []; // user tags
			tagsToAdd[1] = []; // automatic tags
			
			for(var i=0; i<item.tags.length; i++) {
				var tag = item.tags[i];
				
				if(typeof(tag) == "string") {
					// accept strings in tag array as automatic tags, or, if
					// importing, as non-automatic tags
					if(this._forceTagType) {
						tagsToAdd[this._forceTagType].push(tag);
					} else {
						tagsToAdd[0].push(tag);
					}
				} else if(typeof(tag) == "object") {
					// also accept objects
					if(tag.tag || tag.name) {
						if(this._forceTagType) {
							var tagType = this._forceTagType;
						} else if(tag.type) { 
							// skip automatic tags during import too (?)
							if(tag.type == 1 && !tagPref) continue;
							var tagType = tag.type;
						} else {
							var tagType = 0;
						}
						tagsToAdd[tagType].push(tag.tag ? tag.tag : tag.name);
					}
				}
			}
			
			for (var type in [0, 1]) {
				if (tagsToAdd[type].length) {
					newItem.addTags(tagsToAdd[type], type);
				}
			}
		}
	}
}

Zotero.Translate.ItemGetter = function() {
	this._itemsLeft = null;
	this._collectionsLeft = null;
	this._exportFileDirectory = null;
};

Zotero.Translate.ItemGetter.prototype = {
	"setItems":function(items) {
		this._itemsLeft = items;
		this.numItems = this._itemsLeft.length;
	},
	
	"setCollection":function(collection, getChildCollections) {
		// get items in this collection
		var haveItems = {};
		this._itemsLeft = collection.getChildItems();
		for each(var item in this._itemsLeft) haveItems[item.id] = true;
		if(!this._itemsLeft) {
			this._itemsLeft = [];
		}
		
		if(getChildCollections) {
			// get child collections
			this._collectionsLeft = Zotero.getCollections(collection.id, true);
			
			// get items in child collections
			for each(var collection in this._collectionsLeft) {
				var childItems = collection.getChildItems();
				if(childItems) {
					for each(var item in childItems) {
						if(!haveItems[item.id]) {
							haveItems[item.id] = true;
							this._itemsLeft.push(item);;
						}
					}
				}
			}
		}
		
		this.numItems = this._itemsLeft.length;
	},
	
	"setAll":function(getChildCollections) {
		this._itemsLeft = Zotero.Items.getAll(true);
		
		if(getChildCollections) {
			this._collectionsLeft = Zotero.getCollections();
		}
		
		this.numItems = this._itemsLeft.length;
	},
	
	"exportFiles":function(dir, extension) {
		// generate directory
		this._exportFileDirectory = Components.classes["@mozilla.org/file/local;1"].
		                createInstance(Components.interfaces.nsILocalFile);
		this._exportFileDirectory.initWithFile(dir.parent);
		
		// delete this file if it exists
		if(dir.exists()) {
			dir.remove(true);
		}
		
		// get name
		var name = dir.leafName;
		this._exportFileDirectory.append(name);
		
		// create directory
		this._exportFileDirectory.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0700);
		
		// generate a new location for the exported file, with the appropriate
		// extension
		var location = Components.classes["@mozilla.org/file/local;1"].
		                createInstance(Components.interfaces.nsILocalFile);
		location.initWithFile(this._exportFileDirectory);
		location.append(name+"."+extension);

		return location;
	},
	
	/**
	 * Converts an attachment to array format and copies it to the export folder if desired
	 */
	"_attachmentToArray":function(attachment) {
		var attachmentArray = this._itemToArray(attachment);
		var linkMode = attachment.attachmentLinkMode;
		
		// Get mime type
		attachmentArray.mimeType = attachmentArray.uniqueFields.mimeType = attachment.attachmentMIMEType;
		// Get charset
		attachmentArray.charset = attachmentArray.uniqueFields.charset = attachment.attachmentCharset;
		if(linkMode != Zotero.Attachments.LINK_MODE_LINKED_URL) {
			var attachFile = attachment.getFile();
			attachmentArray.localPath = attachFile.path;
			
			if(this._exportFileDirectory) {
				var exportDir = this._exportFileDirectory;
				
				// Add path and filename if not an internet link
				var attachFile = attachment.getFile();
				if(attachFile) {
					attachmentArray.defaultPath = "files/" + attachmentArray.itemID + "/" + attachFile.leafName;
					attachmentArray.filename = attachFile.leafName;
					
					/**
					 * Copies the attachment file to the specified relative path from the
					 * export directory.
					 * @param {String} attachPath The path to which the file should be exported 
					 *    including the filename. If supporting files are included, they will be
					 *    copied as well without any renaming. 
					 * @param {Boolean} overwriteExisting Optional - If this is set to false, the
					 *    function will throw an error when exporting a file would require an existing
					 *    file to be overwritten. If true, the file will be silently overwritten.
					 *    defaults to false if not provided. 
					 */
					attachmentArray.saveFile = function(attachPath, overwriteExisting) {
						// Ensure a valid path is specified
						if(attachPath === undefined || attachPath == "") {
							throw new Error("ERROR_EMPTY_PATH");
						}
						
						// Set the default value of overwriteExisting if it was not provided
						if (overwriteExisting === undefined) {
							overwriteExisting = false;
						}
						
						// Separate the path into a list of subdirectories and the attachment filename,
						// and initialize the required file objects
						var targetFile = Components.classes["@mozilla.org/file/local;1"].
								createInstance(Components.interfaces.nsILocalFile);
						targetFile.initWithFile(exportDir);
						for each(var dir in attachPath.split("/")) targetFile.append(dir);
						
						// First, check that we have not gone lower than exportDir in the hierarchy
						var parent = targetFile, inExportFileDirectory;
						while((parent = parent.parent)) {
							if(exportDir.equals(parent)) {
								inExportFileDirectory = true;
								break;
							}
						}
						
						if(!inExportFileDirectory) {
							throw new Error("Invalid path; attachment cannot be placed above export "+
								"directory in the file hirarchy");
						}
						
						// Create intermediate directories if they don't exist
						parent = targetFile;
						while((parent = parent.parent) && !parent.exists()) {
							parent.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0700);
						}
						
						// Delete any existing file if overwriteExisting is set, or throw an exception
						// if it is not
						if(targetFile.exists()) {
							if(overwriteExisting) {
								targetFile.remove(false);
							} else {
								throw new Error("ERROR_FILE_EXISTS " + targetFile.leafName);
							}
						}
						
						var directory = targetFile.parent;
						
						// The only attachments that can have multiple supporting files are imported
						// attachments of mime type text/html (specified in Attachments.getNumFiles())
						if(attachment.attachmentMIMEType == "text/html"
								&& linkMode != Zotero.Attachments.LINK_MODE_LINKED_FILE
								&& Zotero.Attachments.getNumFiles(attachment) > 1) {
							// Attachment is a snapshot with supporting files. Check if any of the
							// supporting files would cause a name conflict, and build a list of transfers
							// that should be performed
							var copySrcs = [];
							var files = attachment.getFile().parent.directoryEntries;
							while (files.hasMoreElements()) {
								file = files.getNext();
								file.QueryInterface(Components.interfaces.nsIFile);
								
								// Ignore the main attachment file (has already been checked for name conflict)
								if(attachFile.equals(file)) {
									continue;
								}
								
								// Remove any existing files in the target destination if overwriteExisting 
								// is set, or throw an exception if it is not
								var targetSupportFile = targetFile.parent.clone();
								targetSupportFile.append(file.leafName);
								if(targetSupportFile.exists()) {
									if(overwriteExisting) {
										targetSupportFile.remove(false);
									} else {
										throw new Error("ERROR_FILE_EXISTS " + targetSupportFile.leafName);
									}
								}
								copySrcs.push(file.clone());
							}
							
							// No conflicts were detected or all conflicts were resolved, perform the copying
							attachFile.copyTo(directory, targetFile.leafName);
							for(var i = 0; i < copySrcs.length; i++) {
								copySrcs[i].copyTo(directory, copySrcs[i].leafName);
							}
						} else {
							// Attachment is a single file
							// Copy the file to the specified location
							attachFile.copyTo(directory, targetFile.leafName);
						}
						
						attachmentArray.path = targetFile.path;
					};
				}
			}
		}
		
		attachmentArray.itemType = "attachment";
		
		return attachmentArray;
	},
		
	/**
	 * Converts an item to array format
	 */
	"_itemToArray":function(returnItem) {
		// TODO use Zotero.Item#serialize()
		var returnItemArray = returnItem.toArray();
		
		// Remove SQL date from multipart dates
		if (returnItemArray.date) {
			returnItemArray.date = Zotero.Date.multipartToStr(returnItemArray.date);
		}
		
		var returnItemArray = Zotero.Utilities.itemToExportFormat(returnItemArray);
		
		// TODO: Change tag.tag references in translators to tag.name
		// once translators are 1.5-only
		// TODO: Preserve tag type?
		if (returnItemArray.tags) {
			for (var i in returnItemArray.tags) {
				returnItemArray.tags[i].tag = returnItemArray.tags[i].fields.name;
			}
		}
		
		// add URI
		returnItemArray.uri = Zotero.URI.getItemURI(returnItem);
		
		return returnItemArray;
	},
	
	/**
	 * Retrieves the next available item
	 */
	"nextItem":function() {
		while(this._itemsLeft.length != 0) {
			var returnItem = this._itemsLeft.shift();
			// export file data for single files
			if(returnItem.isAttachment()) {		// an independent attachment
				var returnItemArray = this._attachmentToArray(returnItem);
				if(returnItemArray) return returnItemArray;
			} else {
				var returnItemArray = this._itemToArray(returnItem);
				
				// get attachments, although only urls will be passed if exportFileData is off
				returnItemArray.attachments = new Array();
				var attachments = returnItem.getAttachments();
				for each(var attachmentID in attachments) {
					var attachment = Zotero.Items.get(attachmentID);
					var attachmentInfo = this._attachmentToArray(attachment);
					
					if(attachmentInfo) {
						returnItemArray.attachments.push(attachmentInfo);
					}
				}
				
				return returnItemArray;
			}
		}
		return false;
	},
	
	"nextCollection":function() {
		if(!this._collectionsLeft || this._collectionsLeft.length == 0) return false;
	
		var returnItem = this._collectionsLeft.shift();
		var obj = returnItem.serialize(true);
		obj.id = obj.primary.collectionID;
		obj.name = obj.fields.name;
		return obj;
	}
}
Zotero.Translate.ItemGetter.prototype.__defineGetter__("numItemsRemaining", function() { return this._itemsLeft.length });