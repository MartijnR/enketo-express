/* global describe, it, beforeEach*/
'use strict';

global.Promise = require( 'lie' );

var chai = require( 'chai' );
var expect = chai.expect;
var $ = require( 'jquery' );
var chaiAsPromised = require( 'chai-as-promised' );
var utils = require( '../../public/js/src/module/utils' );
var FieldSubmissionQueue = require( '../../public/js/src/module/field-submission-queue' );

chai.use( chaiAsPromised );

var getFieldValue = function( fd ) {
    return utils.blobToString( fd.getAll( 'xml_submission_fragment_file' )[ 0 ] );
};

describe( 'Field Submission', function() {
    var p1 = '/a/b/c';
    var p2 = '/a/r[3]/d';
    var id = 'abc';
    var did = 'def';

    describe( 'queue', function() {

        it( 'adds regular items', function() {
            var q = new FieldSubmissionQueue();
            q.addFieldSubmission( p1, '<one>1</one>', id );
            q.addFieldSubmission( p2, '<a>a</a>', id );

            return Promise.all( [
                expect( Object.keys( q.get() ).length ).to.equal( 2 ),
                expect( q.get()[ 'POST_' + p1 ] ).to.be.an.instanceOf( FormData ),
                expect( q.get()[ 'POST_' + p2 ] ).to.be.an.instanceOf( FormData ),
                expect( getFieldValue( q.get()[ 'POST_' + p1 ] ) ).to.eventually.equal( '<one>1</one>' ),
                expect( getFieldValue( q.get()[ 'POST_' + p2 ] ) ).to.eventually.equal( '<a>a</a>' )
            ] );
        } );

        it( 'overwrites older values in the queue for the same node', function() {
            var q = new FieldSubmissionQueue();
            q.addFieldSubmission( p1, '<one>1</one>', id );
            q.addFieldSubmission( p1, '<two>2</two>', id );

            return Promise.all( [
                expect( Object.keys( q.get() ).length ).to.equal( 1 ),
                expect( q.get()[ 'POST_' + p1 ] ).to.be.an.instanceOf( FormData ),
                expect( getFieldValue( q.get()[ 'POST_' + p1 ] ) ).to.eventually.deep.equal( '<two>2</two>' )
            ] );
        } );

        it( 'adds edits of already submitted items', function() {
            var q = new FieldSubmissionQueue();
            q.addFieldSubmission( p1, '<one>1</one>', id, did );
            q.addFieldSubmission( p2, '<a>a</a>', id, did );

            return Promise.all( [
                expect( Object.keys( q.get() ).length ).to.equal( 2 ),
                expect( q.get()[ 'PUT_' + p1 ] ).to.be.an.instanceOf( FormData ),
                expect( q.get()[ 'PUT_' + p2 ] ).to.be.an.instanceOf( FormData ),
                expect( getFieldValue( q.get()[ 'PUT_' + p1 ] ) ).to.eventually.equal( '<one>1</one>' ),
                expect( getFieldValue( q.get()[ 'PUT_' + p2 ] ) ).to.eventually.equal( '<a>a</a>' )
            ] );
        } );

        it( 'overwrites older values of edited already-submitted items', function() {
            var q = new FieldSubmissionQueue();
            q.addFieldSubmission( p1, '<one>1</one>', id, did );
            q.addFieldSubmission( p1, '<two>2</two>', id, did );

            return Promise.all( [
                expect( Object.keys( q.get() ).length ).to.equal( 1 ),
                expect( q.get()[ 'PUT_' + p1 ] ).to.be.an.instanceOf( FormData ),
                expect( getFieldValue( q.get()[ 'PUT_' + p1 ] ) ).to.eventually.equal( '<two>2</two>' )
            ] );
        } );

        it( 'adds items that delete a repeat', function() {
            var q = new FieldSubmissionQueue();
            q.addRepeatRemoval( '<one>1</one>', id );
            q.addRepeatRemoval( '<a>a</a>', id, did );

            return Promise.all( [
                expect( Object.keys( q.get() ).length ).to.equal( 2 ),
                expect( q.get()[ 'DELETE_0' ] ).to.be.an.instanceOf( FormData ),
                expect( q.get()[ 'DELETE_1' ] ).to.be.an.instanceOf( FormData ),
                expect( getFieldValue( q.get()[ 'DELETE_0' ] ) ).to.eventually.equal( '<one>1</one>' ),
                expect( getFieldValue( q.get()[ 'DELETE_1' ] ) ).to.eventually.equal( '<a>a</a>' )
            ] );
        } );

    } );

    describe( 'queue manages submission failures and successes', function() {
        var q;
        var i;
        var failSubmitOne = function() {
            return Promise.reject( new Error( 'Error: 400' ) );
        };
        var succeedSubmitOne = function() {
            return Promise.resolve( 201 );
        };
        var succeedFailSubmitOne = function() {
            i++;
            return ( i % 2 === 0 ) ? failSubmitOne() : succeedSubmitOne();
        };

        beforeEach( function() {
            i = 0;
            q = new FieldSubmissionQueue();
            q.addFieldSubmission( p1, '1', id );
            q.addFieldSubmission( p2, 'a', id );
        } );

        it( 'removes a queue item if submission was successful', function() {
            q._submitOne = succeedSubmitOne;

            var updatedQueueKeys = q.submitAll()
                .then( function( results ) {
                    return Object.keys( q.get() );
                } );
            return expect( updatedQueueKeys ).to.eventually.deep.equal( [] );
        } );

        it( 'ignores new fieldsubmissions if they are the same as the last for that field', function() {
            q._submitOne = succeedSubmitOne;

            var updatedQueueKeys = q.submitAll()
                .then( function( results ) {
                    q.addFieldSubmission( p1, '1', id );
                    q.addFieldSubmission( p2, 'a', id );
                    return Object.keys( q.get() );
                } );
            return expect( updatedQueueKeys ).to.eventually.deep.equal( [] );
        } );

        it( 'retains a queue item if submission failed', function() {
            q._submitOne = failSubmitOne;

            var updatedQueueKeys = q.submitAll()
                .then( function( results ) {
                    return Object.keys( q.get() );
                } );
            return expect( updatedQueueKeys ).to.eventually.deep.equal( [ 'POST_' + p1, 'POST_' + p2 ] );
        } );

        it( 'retains a queue item if submission failed', function() {
            q._submitOne = succeedFailSubmitOne;

            var updatedQueueKeys = q.submitAll()
                .then( function( results ) {
                    return Object.keys( q.get() );
                } );
            return expect( updatedQueueKeys ).to.eventually.deep.equal( [ 'POST_' + p2 ] );
        } );

        it( 'if a field is updated during a failing submission attempt, ' +
            'the old field submission will not be retained in the queue',
            function() {
                q._submitOne = succeedFailSubmitOne;

                var updatedQueue = q.submitAll()
                    .then( function( results ) {
                        return q.get();
                    } );
                // this will complete before updatedQueueKeys is resolved!
                q.addFieldSubmission( p2, 'b', id );

                return Promise.all( [
                    expect( updatedQueue ).to.eventually.have.property( 'POST_' + p2 ),
                    expect( updatedQueue.then( function( q ) {
                        return getFieldValue( q[ 'POST_' + p2 ] );
                    } ) ).to.eventually.equal( 'b' ),
                    expect( updatedQueue ).to.eventually.not.have.property( 'POST_' + p1 )
                ] );
            } );
    } );

    // TODO
    // * timeout


} );
