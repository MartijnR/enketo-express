/**
 * Deals with the main high level survey controls for the special online-only auto-fieldsubmission view.
 *
 * Field values are automatically submitted upon change to a special OpenClinica Field Submission API.
 */

'use strict';

var gui = require( './gui' );
var settings = require( './settings' );
var Form = require( 'enketo-core' );
var fileManager = require( './file-manager' );
var t = require( './translator' ).t;
var $ = require( 'jquery' );
var FieldSubmissionQueue = require( './field-submission-queue' );
var fieldSubmissionQueue;
var rc = require( './controller-webform' );
var reasons = require( './reasons' );
var DEFAULT_THANKS_URL = '/thanks';
var form;
var formSelector;
var formData;
var $formprogress;
var ignoreBeforeUnload = false;

var formOptions = {
    goTo: settings.goTo,
    printRelevantOnly: settings.printRelevantOnly
};

// Modify Enketo Core
require( './Form' );


function init( selector, data ) {
    var advice;
    var loadErrors = [];

    formSelector = selector;
    formData = data;
    $formprogress = $( '.form-progress' );

    return new Promise( function( resolve, reject ) {

            if ( data.instanceAttachments ) {
                fileManager.setInstanceAttachments( data.instanceAttachments );
            }

            form = new Form( formSelector, data, formOptions );
            fieldSubmissionQueue = new FieldSubmissionQueue();

            // remove submit button before event handlers are set
            _removeCompleteButtonIfNeccessary();

            // set eventhandlers before initializing form
            _setEventHandlers( selector );

            // listen for "gotohidden.enketo" event and add error
            $( formSelector ).on( 'gotohidden.enketo', function( e ) {
                // In OC hidden go_to fields should show loadError except if go_to field is a disrepancy_note
                // as those are always hidden upon load.
                if ( !e.target.classList.contains( 'or-appearance-dn' ) ) {
                    loadErrors.push( t( 'alert.gotohidden.msg', {
                        path: location.hash.substring( 1 )
                    } ) );
                }
            } );

            loadErrors = loadErrors.concat( form.init() );

            if ( form.encryptionKey ) {
                loadErrors.unshift( '<strong>' + t( 'error.encryptionnotsupported' ) + '</strong>' );
            }

            rc.setLogoutLinkVisibility();

            if ( loadErrors.length > 0 ) {
                throw loadErrors;
            }
            resolve( form );
        } )
        .catch( function( error ) {
            if ( Array.isArray( error ) ) {
                loadErrors = error;
            } else {
                loadErrors.unshift( error.message || t( 'error.unknown' ) );
            }

            advice = ( data.instanceStr ) ? t( 'alert.loaderror.editadvice' ) : t( 'alert.loaderror.entryadvice' );
            gui.alertLoadErrors( loadErrors, advice );
        } )
        .then( function( form ) {
            // OC will return even if there were errors.
            return form;
        } );
}

/**
 * Controller function to reset to a blank form. Checks whether all changes have been saved first
 * @param  {boolean=} confirmed Whether unsaved changes can be discarded and lost forever
 */
/*function _resetForm( confirmed ) {
    var message;
    var choices;

    if ( !confirmed && form.editStatus ) {
        message = t( 'confirm.save.msg' );
        choices = {
            posAction: function() {
                _resetForm( true );
            }
        };
        gui.confirm( message, choices );
    } else {
        //_setDraftStatus( false );
        form.resetView();
        ignoreBeforeUnload = false;
        form = new Form( formSelector, {
            modelStr: formData.modelStr,
            external: formData.external
        }, formOptions );
        form.init();
        form.view.$
            .trigger( 'formreset' );
    }
}*/

/**
 * Closes the form after checking that the queue is empty.
 *
 * TODO: I think this can probably be reorganized to avoid the bypassAutoQuery parameter. 
 * See the _closeCompleteRecord for example.
 * 
 * @return {Promise} [description]
 */
function _close( bypassAutoQuery ) {
    var msg = '';
    var tAlertCloseMsg = t( 'fieldsubmission.alert.close.msg1' );
    var tAlertCloseHeading = t( 'fieldsubmission.alert.close.heading1' );
    var authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';
    var $violated = form.view.$.find( '.invalid-constraint' );

    // First check if any constraints have been violated and prompt option to generate automatic queries
    if ( !bypassAutoQuery && $violated.length ) {
        return new Promise( function( resolve, reject ) {
            gui.confirm( {
                heading: t( 'alert.default.heading' ),
                errorMsg: t( 'fieldsubmission.confirm.autoquery.msg1' ),
                msg: t( 'fieldsubmission.confirm.autoquery.msg2' )
            }, {
                posButton: t( 'fieldsubmission.confirm.autoquery.automatic' ),
                negButton: t( 'fieldsubmission.confirm.autoquery.manual' ),
                posAction: function() {
                    _autoAddQueries( $violated );
                    resolve( true );
                },
                negAction: function() {
                    resolve( false );
                }
            } );
        } );
    }

    // Start with actually closing, but only proceed once the queue is emptied.
    gui.alert( tAlertCloseMsg + '<br/>' +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', tAlertCloseHeading, 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                throw new Error( t( 'fieldsubmission.alert.close.msg2' ) );
            } else {
                // this event is used in communicating back to iframe parent window
                $( document ).trigger( 'close' );

                msg += t( 'alert.submissionsuccess.redirectmsg' );
                gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
                _redirect();
            }
        } )
        .catch( function( error ) {
            var errorMsg;
            error = error || {};

            console.error( 'close error', error );
            if ( error.status === 401 ) {
                errorMsg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
                gui.alert( errorMsg, t( 'alert.submissionerror.heading' ) );
            } else {
                errorMsg = error.message || gui.getErrorResponseMsg( error.status );
                gui.confirm( {
                    heading: t( 'alert.default.heading' ),
                    errorMsg: errorMsg,
                    msg: t( 'fieldsubmission.confirm.leaveanyway.msg' )
                }, {
                    posButton: t( 'confirm.default.negButton' ),
                    negButton: t( 'fieldsubmission.confirm.leaveanyway.button' ),
                    posAction: function() {},
                    negAction: function() {
                        _redirect( 100 );
                    }
                } );
            }

        } );
}

function _closeSimple() {
    var msg = '';
    var tAlertCloseMsg = t( 'fieldsubmission.alert.close.msg1' );
    var tAlertCloseHeading = t( 'fieldsubmission.alert.close.heading1' );
    var authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';

    // Start with actually closing, but only proceed once the queue is emptied.
    gui.alert( tAlertCloseMsg + '<br/>' +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', tAlertCloseHeading, 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                throw new Error( t( 'fieldsubmission.alert.close.msg2' ) );
            } else {
                // this event is used in communicating back to iframe parent window
                $( document ).trigger( 'close' );

                msg += t( 'alert.submissionsuccess.redirectmsg' );
                gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
                _redirect();
            }
        } )
        .catch( function( error ) {
            var errorMsg;
            error = error || {};

            console.error( 'close error', error );
            if ( error.status === 401 ) {
                errorMsg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
                gui.alert( errorMsg, t( 'alert.submissionerror.heading' ) );
            } else {
                errorMsg = error.message || gui.getErrorResponseMsg( error.status );
                gui.confirm( {
                    heading: t( 'alert.default.heading' ),
                    errorMsg: errorMsg,
                    msg: t( 'fieldsubmission.confirm.leaveanyway.msg' )
                }, {
                    posButton: t( 'confirm.default.negButton' ),
                    negButton: t( 'fieldsubmission.confirm.leaveanyway.button' ),
                    posAction: function() {},
                    negAction: function() {
                        _redirect( 100 );
                    }
                } );
            }

        } );
}

// This is conceptually a Complete function that has some pre-processing.
function _closeCompletedRecord() {
    var $violated;

    return form.validate()
        .then( function( valid ) {
            if ( reasons.validate() && valid ) {
                // do not show confirmation dialog
                return _complete( true );
            } else if ( form.view.$.find( '.invalid-relevant' ).length ) {
                gui.alert( t( 'fieldsubmission.alert.relevantvalidationerror.msg' ) );

                return false;
            } else if ( $( '.reason-for-change .invalid' ).length ) {
                gui.alert( t( 'fieldsubmission.alert.reasonforchangevalidationerror.msg' ) );
            } else {
                $violated = form.view.$.find( '.invalid-constraint, .invalid-required' );
                // Note that unlike _close this also looks at .invalid-required.
                gui.confirm( {
                    heading: t( 'alert.default.heading' ),
                    errorMsg: t( 'fieldsubmission.confirm.autoquery.msg1' ),
                    msg: t( 'fieldsubmission.confirm.autoquery.msg2' )
                }, {
                    posButton: t( 'fieldsubmission.confirm.autoquery.automatic' ),
                    negButton: t( 'fieldsubmission.confirm.autoquery.manual' ),
                    posAction: function() {
                        _autoAddQueries( $violated );
                        return _closeCompletedRecord();
                    },
                    negAction: function() {
                        return false;
                    }
                } );
            }
        } );
}

function _redirect( msec ) {
    ignoreBeforeUnload = true;
    setTimeout( function() {
        location.href = decodeURIComponent( settings.returnUrl || DEFAULT_THANKS_URL );
    }, msec || 1200 );
}

/**
 * Finishes a submission
 *
 * TODO: I think this can probably be reorganized to avoid the bypassConfirmation parameter. 
 * See the _closeCompleteRecord for example.
 * 
 */
function _complete( bypassConfirmation ) {
    var beforeMsg;
    var authLink;
    var instanceId;
    var deprecatedId;
    var msg = '';

    // First check if any constraints have been violated and prompt option to generate automatic queries
    if ( !bypassConfirmation ) {
        return new Promise( function( resolve, reject ) {
            gui.confirm( {
                heading: t( 'fieldsubmission.confirm.complete.heading' ),
                msg: t( 'fieldsubmission.confirm.complete.msg' )
            }, {
                posAction: function() {
                    resolve( true );
                },
                negAction: function() {
                    resolve( false );
                }
            } );
        } );
    }

    form.view.$.trigger( 'beforesave' );

    beforeMsg = t( 'alert.submission.redirectmsg' );
    authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';

    gui.alert( beforeMsg +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', t( 'alert.submission.msg' ), 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            var queueLength = Object.keys( fieldSubmissionQueue.get() ).length;

            if ( queueLength === 0 ) {
                instanceId = form.instanceID;
                deprecatedId = form.deprecatedID;
                return fieldSubmissionQueue.complete( instanceId, deprecatedId );
            } else {
                throw new Error( t( 'fieldsubmission.alert.complete.msg' ) );
            }
        } )
        .then( function() {
            // this event is used in communicating back to iframe parent window
            $( document ).trigger( 'submissionsuccess' );

            msg += t( 'alert.submissionsuccess.redirectmsg' );
            gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
            _redirect();
        } )
        .catch( function( result ) {
            result = result || {};
            console.error( 'submission failed' );
            if ( result.status === 401 ) {
                msg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
            } else {
                msg = result.message || gui.getErrorResponseMsg( result.status );
            }
            gui.alert( msg, t( 'alert.submissionerror.heading' ) );
        } );
}

function _removeCompleteButtonIfNeccessary() {
    // for readonly and note-only views
    if ( settings.type === 'view' || /\/fs\/dnc?\//.test( window.location.pathname ) ) {
        $( 'button#finish-form' ).remove();
        $( 'button#close-form' ).addClass( 'simple' );
    } else if ( settings.type === 'edit' && !settings.completeButton ) {
        // In the future we can use a more robust way to do this by inspecting the record.
        $( 'button#finish-form' ).remove();
        // Change the behavior of the Close button in edit views except in note-only views
        $( 'button#close-form' ).addClass( 'completed-record' );
    }
}

function _autoAddQueries( $questions ) {
    $questions.trigger( 'addquery.oc' );
}

function _setEventHandlers( selector ) {
    var $doc = $( document );
    $doc
        .on( 'progressupdate.enketo', selector, function( event, status ) {
            if ( $formprogress.length > 0 ) {
                $formprogress.css( 'width', status + '%' );
            }
        } )
        // After repeat removal from view (before removal from model)
        .on( 'removed.enketo', function( event, updated ) {
            var instanceId = form.instanceID;
            if ( !updated.xmlFragment ) {
                console.error( 'Could not submit repeat removal fieldsubmission. XML fragment missing.' );
                return;
            }
            if ( !instanceId ) {
                console.error( 'Could not submit repeat removal fieldsubmission. InstanceID missing' );
            }

            fieldSubmissionQueue.addRepeatRemoval( updated.xmlFragment, instanceId, form.deprecatedID );
            fieldSubmissionQueue.submitAll();
        } )
        // Field is changed
        .on( 'dataupdate.enketo', selector, function( event, updated ) {
            var instanceId = form.instanceID;
            var file;

            if ( updated.cloned ) {
                // This event is fired when a repeat is cloned. It does not trigger
                // a fieldsubmission.
                return;
            }

            if ( !updated.xmlFragment ) {
                console.error( 'Could not submit field. XML fragment missing. (If repeat was deleted, this is okay.)' );
                return;
            }
            if ( !instanceId ) {
                console.error( 'Could not submit field. InstanceID missing' );
                return;
            }
            if ( !updated.fullPath ) {
                console.error( 'Could not submit field. Path missing.' );
            }

            if ( updated.file ) {
                file = fileManager.getCurrentFile( updated.file );
            }
            // Only now will we check for the deprecatedID value, which at this point should be (?) 
            // populated at the time the instanceID dataupdate event is processed and added to the fieldSubmission queue.
            fieldSubmissionQueue.addFieldSubmission( updated.fullPath, updated.xmlFragment, instanceId, form.deprecatedID, file );
            fieldSubmissionQueue.submitAll();

        } );

    // Before repeat removal from view and model
    if ( settings.reasonForChange ) {
        // We need to catch the click before repeat.js does. So 
        // we attach the handler to a lower level DOM element and make sure it's only attached once.
        $( '.or-repeat-info' ).parent( '.or-group, .or-group-data' ).on( 'click.propagate', 'button.remove:enabled', function( evt, data ) {
            if ( data && data.propagate ) {
                return true;
            }
            // Any form controls inside the repeat need a Reason for Change
            // TODO: exclude controls that have no value?
            var $questions = $( evt.currentTarget ).closest( '.or-repeat' ).find( '.question:not(.disabled)' );
            var texts = {
                heading: t( 'fieldsubmission.prompt.reason.heading' ),
                msg: t( 'fieldsubmission.prompt.reason.msg' )
            };
            var inputs = '<p><label><input name="reason" type="text"/></label></p>';
            var options = {
                posAction: function( values ) {
                    if ( !values.reason || !values.reason.trim() ) {
                        // TODO: something
                    } else {
                        $questions.trigger( 'reasonchange.enketo', values );
                        // Propagate to repeat.js
                        $( evt.currentTarget ).trigger( 'click', {
                            propagate: true
                        } );
                        reasons.updateNumbering();
                    }
                }
            };
            gui.prompt( texts, options, inputs );

            return false;
        } );

        $( '.form-footer' ).find( '.next-page, .last-page, .previous-page, .first-page' ).on( 'click', function( evt ) {
            var valid = reasons.validate();
            if ( !valid ) {
                evt.stopImmediatePropagation();

                return false;
            }
            reasons.clearAll();
            return true;
        } );
    }

    $( 'button#close-form:not(.completed-record, .simple)' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        _close()
            .then( function( again ) {
                if ( again ) {
                    return _close( true );
                }
            } )
            .catch( function( e ) {
                console.error( e );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    $( 'button#finish-form' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        // form.validate() will trigger fieldsubmissions for timeEnd before it resolves
        form.validate()
            .then( function( valid ) {
                if ( valid ) {
                    return _complete()
                        .then( function( again ) {
                            if ( again ) {
                                return _complete( again );
                            }
                        } );
                } else {
                    if ( form.view.$.find( '.invalid-relevant' ).length ) {
                        gui.alert( t( 'fieldsubmission.alert.relevantvalidationerror.msg' ) );
                    } else {
                        gui.alert( t( 'fieldsubmission.alert.validationerror.msg' ) );
                    }
                }
            } )
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    // This is for closing a record that was marked as final. It's quite different
    // from Complete or the regular Close.
    $( 'button#close-form.completed-record' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        // form.validate() will trigger fieldsubmissions for timeEnd before it resolves
        _closeCompletedRecord()
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    // This is for closing a record in a readonly or note-only view.
    $( 'button#close-form.simple' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        _closeSimple()
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    if ( rc.inIframe() && settings.parentWindowOrigin ) {
        $doc.on( 'submissionsuccess edited.enketo close', rc.postEventAsMessageToParentWindow );
    }

    window.onbeforeunload = function() {
        if ( !ignoreBeforeUnload ) {
            _autoAddQueries( form.view.$.find( '.invalid-constraint' ) );
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                return 'Any unsaved data will be lost';
            }
        }
    };
}

module.exports = {
    init: init
};
