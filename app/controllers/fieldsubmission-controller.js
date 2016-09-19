'use strict';

var communicator = require( '../lib/communicator' );
var surveyModel = require( '../models/survey-model' );
var userModel = require( '../models/user-model' );
var utils = require( '../lib/utils' );
var request = require( 'request' );
var express = require( 'express' );
var router = express.Router();
// var debug = require( 'debug' )( 'fieldsubmission-controller' );

module.exports = function( app ) {
    app.use( app.get( 'base path' ) + '/fieldsubmission', router );
};

// duplicate in survey-controller and submission-controller
router.param( 'enketo_id', function( req, res, next, id ) {
    if ( /^::[A-z0-9]{4,8}$/.test( id ) ) {
        req.enketoId = id.substring( 2 );
        next();
    } else {
        next( 'route' );
    }
} );

router
    .all( '*', function( req, res, next ) {
        res.set( 'Content-Type', 'application/json' );
        next();
    } )
    .post( '/:enketo_id', submit )
    .post( '/complete/:enketo_id', complete )
    .put( '/:enketo_id', submit )
    .put( '/complete/:enketo_id', complete )
    .delete( '/:enketo_id', submit )
    .all( '/*', function( req, res, next ) {
        var error = new Error( 'Not allowed' );
        error.status = 405;
        next( error );
    } );

function complete( req, res, next ) {
    _request( 'field', req, res, next );
}

function submit( req, res, next ) {
    _request( 'complete', req, res, next );
}

/** 
 * Simply pipes well-formed request to the OpenRosa server and
 * copies the response received.
 *
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
function _request( type, req, res, next ) {
    var credentials;
    var options;
    var submissionUrl;
    var paramName = req.app.get( 'query parameter to pass to submission' );
    var paramValue = req.query[ paramName ];
    var query = ( paramValue ) ? '?' + paramName + '=' + paramValue : '';
    var id = req.enketoId;

    surveyModel.get( id )
        .then( function( survey ) {
            submissionUrl = ( type === 'complete' ) ? _getSubmissionCompleteUrl( survey.openRosaServer ) + query : _getSubmissionUrl( survey.openRosaServer ) + query;
            credentials = userModel.getCredentials( req );

            // first check if authentication is required and if so get the Basic or Digest Authorization header
            return communicator.getAuthHeader( submissionUrl, credentials );
        } )
        .then( function( authHeader ) {
            options = {
                url: submissionUrl,
                headers: authHeader ? {
                    'Authorization': authHeader
                } : {}
            };

            // pipe the request 
            req.pipe( request( options ) ).on( 'response', function( orResponse ) {
                if ( orResponse.statusCode === 201 ) {
                    // TODO: Do we really want to log all field submissions? It's a huge amount.
                    // _logSubmission( id, instanceId, deprecatedId );
                } else if ( orResponse.statusCode === 401 ) {
                    // replace the www-authenticate header to avoid browser built-in authentication dialog
                    orResponse.headers[ 'WWW-Authenticate' ] = 'enketo' + orResponse.headers[ 'WWW-Authenticate' ];
                }
            } ).pipe( res );

        } )
        .catch( next );
}

function _getSubmissionUrl( server ) {
    return ( server.lastIndexOf( '/' ) === server.length - 1 ) ? server + 'fieldsubmission' : server + '/fieldsubmission';
}

function _getSubmissionCompleteUrl( server ) {
    return ( server.lastIndexOf( '/' ) === server.length - 1 ) ? server + 'fieldsubmission' : server + '/fieldsubmission/complete';
}


/*
function _logSubmission( id, instanceId, deprecatedId ) {
    submissionModel.isNew( id, instanceId )
        .then( function( notRecorded ) {
            if ( notRecorded ) {
                // increment number of submissions
                surveyModel.incrementSubmissions( id );
                // store/log instanceId
                submissionModel.add( id, instanceId, deprecatedId );
            }
        } )
        .catch( function( error ) {
            console.error( error );
        } );
}
*/
