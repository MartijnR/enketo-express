import './module/radio-tab';
import $ from 'jquery';
import gui from './module/gui';
import controller from './module/controller-webform-fieldsubmission';
import settings from './module/settings';
import connection from './module/connection';
import { init as initTranslator, t, localize } from './module/translator';
import calculationModule from 'enketo-core/src/js/calculate';
import preloadModule from 'enketo-core/src/js/preload';

const $loader = $( '.main-loader' );
const $formheader = $( '.main > .paper > .form-header' );
import oc from './module/custom';
const $footer = $( '.form-footer' );
const survey = {
    enketoId: settings.enketoId,
    serverUrl: settings.serverUrl,
    xformId: settings.xformId,
    xformUrl: settings.xformUrl,
    instanceId: settings.instanceId
};
const loadWarnings = [];

initTranslator( survey )
    .then( connection.getFormParts )
    .then( formParts => {
        if ( location.pathname.indexOf( '/edit/' ) > -1 || location.pathname.indexOf( '/view/' ) > -1 ) {
            if ( survey.instanceId ) {
                return connection.getExistingInstance( survey )
                    .then( response => {
                        formParts.instance = response.instance;
                        formParts.instanceAttachments = response.instanceAttachments;
                        // TODO: this will fail massively if instanceID is not populated (will use POST instead of PUT). Maybe do a check?
                        return formParts;
                    } );
            } else if ( location.pathname.indexOf( '/edit/' ) > -1 ) {
                throw new Error( 'This URL is invalid' );
            }
        }
        return formParts;
    } )
    .then( formParts => {
        if ( formParts.form && formParts.model ) {
            return gui.swapTheme( formParts );
        } else {
            throw new Error( t( 'error.unknown' ) );
        }
    } )
    .then( formParts => {
        if ( /\/fs\/dnc?\//.test( window.location.pathname ) ) {
            return _readonlify( formParts, true );
        } else if ( settings.type === 'view' ) {
            return _readonlify( formParts, false );
        }
        return formParts;
    } )
    .then( _init )
    .then( connection.getMaximumSubmissionSize )
    .then( _updateMaxSizeSetting )
    .catch( _showErrorOrAuthenticate );

function _updateMaxSizeSetting( maxSize ) {
    if ( maxSize ) {
        // overwrite default max size
        settings.maxSize = maxSize;
        $( 'form.or' ).trigger( 'updateMaxSize' );
    }
}

function _showErrorOrAuthenticate( error ) {
    $loader.addClass( 'fail' );
    if ( error.status === 401 ) {
        window.location.href = `/login?return_url=${encodeURIComponent( window.location.href )}`;
    } else {
        gui.alert( error.message, t( 'alert.loaderror.heading' ) );
    }
}

/**
 * Converts questions to readonly
 * Disables calculations, deprecatedID mechanism and preload items.
 * 
 * @param  {[type]} formParts [description]
 * @return {[type]}           [description]
 */
function _readonlify( formParts, notesEnabled ) {
    // Styling changes
    $( 'body' ).addClass( 'oc-view' );

    // Partially disable calculations in Enketo Core
    console.log( 'Calculations restricted to clinicaldata only.' );
    calculationModule.originalUpdate = calculationModule.update;
    calculationModule.update = function( updated ) {
        return calculationModule.originalUpdate.call( this, updated, '[oc-external="clinicaldata"]' );
    };

    // Completely disable preload items
    console.log( 'Preloaders disabled.' );
    preloadModule.init = () => {};
    // change status message
    $( '<div class="fieldsubmission-status readonly"/>' ).prependTo( '.form-header' )
        .add( $( '<div class="form-footer__feedback fieldsubmission-status readonly"/>' ).prependTo( $footer ) )
        .text( notesEnabled ? t( 'fieldsubmission.noteonly.msg' ) : t( 'fieldsubmission.readonly.msg' ) );

    formParts.form = $( formParts.form );
    // Note: Enketo made a syntax error by adding the readonly attribute on a <select>
    // Hence, we cannot use .prop('readonly', true). We'll continue the syntax error.
    formParts.form.find( 'input:not([readonly]), textarea:not([readonly]), select:not(#form-languages):not([readonly])' )
        .filter( function() {
            return notesEnabled ? $( this ).parent( '.or-appearance-dn' ).length === 0 : true;
        } )
        .attr( 'readonly', 'readonly' )
        .addClass( 'readonly-forced' );
    // Properly make native selects readonly (for touchscreens)
    formParts.form.find( 'select:not(#form-languages) option' ).prop( 'disabled', true );
    // Prevent adding an Add/Remove UI on repeats
    formParts.form.find( '.or-repeat-info' ).attr( 'data-repeat-fixed', 'fixed' );
    // Record load warning but keep loading
    if ( settings.loadWarning ) {
        loadWarnings.push( settings.loadWarning );
    }

    return formParts;
}

function _init( formParts ) {
    $formheader.after( formParts.form );
    $( document ).ready( () => {
        localize( document.querySelector( 'form.or' ) );
        controller.init( 'form.or', {
            modelStr: formParts.model,
            instanceStr: formParts.instance,
            external: formParts.externalData,
            instanceAttachments: formParts.instanceAttachments
        }, loadWarnings ).then( form => {
            // Note: be careful, "form" param returned by controller.init is undefined if there were loadErrors (in fs view).
            const $title = $( '#form-title' );
            const title = ( settings.pid ) ? `${settings.pid}: ${$title.text()}` : $title.text();
            $title.text( title );
            $( 'head>title' ).text( title );
            if ( formParts.instance ) {
                oc.addSignedStatus( form );
            }
            if ( settings.print ) {
                gui.applyPrintStyle();
            }
        } );
    } );
}
