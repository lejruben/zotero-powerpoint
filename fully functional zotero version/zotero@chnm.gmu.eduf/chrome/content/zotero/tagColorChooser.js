/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2013 Center for History and New Media
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

"use strict";
var _io;

var Zotero_Tag_Color_Chooser = new function() {
	this.init = function () {
		// Set font size from pref
		Zotero.setFontSize(document.getElementById("tag-color-chooser-container"));
		
		if (window.arguments && window.arguments.length) {
			_io = window.arguments[0];
			if (_io.wrappedJSObject) _io = _io.wrappedJSObject;
		}
		if (typeof _io.libraryID == 'undefined') throw new Error("libraryID not set");
		if (typeof _io.name == 'undefined' || _io.name === "") throw new Error("name not set");
		
		window.sizeToContent();
		
		var dialog = document.getElementById('tag-color-chooser');
		var colorPicker = document.getElementById('color-picker');
		var tagPosition = document.getElementById('tag-position');
		
		colorPicker.setAttribute('cols', 3);
		colorPicker.setAttribute('tileWidth', 24);
		colorPicker.setAttribute('tileHeight', 24);
		colorPicker.colors = [
			'#990000', '#CC9933', '#FF9900',
			'#FFCC00', '#007439', '#1049A9',
			'#9999FF', '#CC66CC', '#993399'
		];
		
		var maxTags = document.getElementById('max-tags');
		maxTags.value = Zotero.getString('tagColorChooser.maxTags', Zotero.Tags.MAX_COLORED_TAGS);
		
		var self = this;
		Zotero.Tags.getColors(_io.libraryID)
		.then(function (tagColors) {
			var colorData = tagColors[_io.name];
			
			// Color
			if (colorData) {
				colorPicker.color = colorData.color;
				dialog.buttons = "extra1,cancel,accept";
			}
			else {
				// Get unused color at random
				var usedColors = [];
				for (var i in tagColors) {
					usedColors.push(tagColors[i].color);
				}
				var unusedColors = Zotero.Utilities.arrayDiff(
					colorPicker.colors, usedColors
				);
				var color = unusedColors[Zotero.Utilities.rand(0, unusedColors.length - 1)];
				colorPicker.color = color;
				dialog.buttons = "cancel,accept";
			}
			colorPicker.setAttribute('disabled', 'false');
			
			var numColors = Object.keys(tagColors).length;
			var max = colorData ? numColors : numColors + 1;
			
			// Position
			for (let i=1; i<=max; i++) {
				tagPosition.appendItem(i, i-1);
			}
			if (numColors) {
				tagPosition.setAttribute('disabled', 'false');
				if (colorData) {
					tagPosition.selectedIndex = colorData.position;
				}
				// If no color currently, default to end
				else {
					tagPosition.selectedIndex = numColors;
				}
			}
			// If no colors currently, only position "1" is available
			else {
				tagPosition.selectedIndex = 0;
			}
			
			self.onPositionChange();
			window.sizeToContent();
		})
		.catch(function (e) {
			Zotero.debug(e, 1);
			Components.utils.reportError(e);
			dialog.cancelDialog();
		})
		.done();
	};
	
	
	this.onPositionChange = function () {
		var tagPosition = document.getElementById('tag-position');
		var instructions = document.getElementById('number-key-instructions');
		
		while (instructions.hasChildNodes()) {
			instructions.removeChild(instructions.firstChild);
		}
		
		var msg = Zotero.getString('tagColorChooser.numberKeyInstructions');
		var matches = msg.match(/(.+)\$NUMBER(.+)/);
		
		var num = document.createElement('label');
		num.id = 'number-key';
		num.setAttribute('value', parseInt(tagPosition.value) + 1);
		
		if (matches) {
			instructions.appendChild(document.createTextNode(matches[1]));
			instructions.appendChild(num);
			instructions.appendChild(document.createTextNode(matches[2]));
		}
		// If no $NUMBER variable in translated string, fail as gracefully as possible
		else {
			instructions.appendChild(document.createTextNode(msg));
		}
	};
	
	
	this.onDialogAccept = function () {
		var colorPicker = document.getElementById('color-picker');
		var tagPosition = document.getElementById('tag-position');
		_io.color = colorPicker.color;
		_io.position = tagPosition.value;
	};
	
	
	this.onDialogCancel = function () {};
	
	
	this.onDialogRemoveColor = function () {
		_io.color = false;
		window.close();
	};
};
