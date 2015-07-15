/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
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


/*
 * Primary interface for accessing Zotero collection
 */
Zotero.Collections = new function() {
	Zotero.DataObjects.apply(this, ['collection']);
	this.constructor.prototype = new Zotero.DataObjects();
	
	this.get = get;
	this.add = add;
	this.getCollectionsContainingItems = getCollectionsContainingItems;
	this.erase = erase;
	
	/*
	 * Returns a Zotero.Collection object for a collectionID
	 */
	function get(id) {
		if (this._reloadCache) {
			this.reloadAll();
		}
		return this._objectCache[id] ? this._objectCache[id] : false;
	}
	
	
	/**
	* Add new collection to DB and return Collection object
	*
	* _name_ is non-empty string
	* _parent_ is optional collectionID -- creates root collection by default
	*
	* Returns true on success; false on error
	**/
	function add(name, parent) {
		var col = new Zotero.Collection;
		col.name = name;
		col.parent = parent;
		var id = col.save();
		return this.get(id);
	}
	
	
	function getCollectionsContainingItems(itemIDs, asIDs) {
		var sql = "SELECT collectionID FROM collections WHERE ";
		var sqlParams = [];
		for each(var id in itemIDs) {
			sql += "collectionID IN (SELECT collectionID FROM collectionItems "
				+ "WHERE itemID=?) AND "
			sqlParams.push(id);
		}
		sql = sql.substring(0, sql.length - 5);
		var collectionIDs = Zotero.DB.columnQuery(sql, sqlParams);
		
		if (asIDs) {
			return collectionIDs;
		}
		
		return Zotero.Collections.get(collectionIDs);
	}
	
	
	/**
	 * Invalidate child collection cache in specified collections, skipping
	 * any that aren't loaded
	 *
	 * @param	{Integer|Integer[]}	ids		One or more itemIDs
	 */
	this.refreshChildCollections = function (ids) {
		ids = Zotero.flattenArguments(ids);
		
		for each(var id in ids) {
			if (this._objectCache[id]) {
				this._objectCache[id]._refreshChildCollections();
			}
		}
	}
	
	
	function erase(ids) {
		ids = Zotero.flattenArguments(ids);
		
		Zotero.DB.beginTransaction();
		for each(var id in ids) {
			var collection = this.get(id);
			if (collection) {
				collection.erase();
			}
			collection = undefined;
		}
		
		this.unload(ids);
		
		Zotero.DB.commitTransaction();
	}
	
	
	this._load = function () {
		if (!arguments[0] && !this._reloadCache) {
			return;
		}
		
		this._reloadCache = false;
		
		// This should be the same as the query in Zotero.Collection.load(),
		// just without a specific collectionID
		var sql = "SELECT C.*, "
			+ "(SELECT COUNT(*) FROM collections WHERE "
			+ "parentCollectionID=C.collectionID)!=0 AS hasChildCollections, "
			+ "(SELECT COUNT(*) FROM collectionItems WHERE "
			+ "collectionID=C.collectionID)!=0 AS hasChildItems "
			+ "FROM collections C WHERE 1";
		if (arguments[0]) {
			sql += " AND collectionID IN (" + Zotero.join(arguments[0], ",") + ")";
		}
		var rows = Zotero.DB.query(sql);
		var ids = [];
		for each(var row in rows) {
			var id = row.collectionID;
			ids.push(id);
			
			// Collection doesn't exist -- create new object and stuff in array
			if (!this._objectCache[id]) {
				//this.get(id);
				this._objectCache[id] = new Zotero.Collection;
				this._objectCache[id].loadFromRow(row);
			}
			// Existing collection -- reload in place
			else {
				this._objectCache[id].loadFromRow(row);
			}
		}
		
		// If loading all creators, remove old creators that no longer exist
		if (!arguments[0]) {
			for each(var c in this._objectCache) {
				if (ids.indexOf(c.id) == -1) {
					this.unload(c.id);
				}
			}
		}
	}
}

