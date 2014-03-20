/**
 * Graticule is a map layer drawing a network of parallels and meridians
 * @param {Object} style The graphical style to apply.
 * @param {Object} scaleVisibility The visibility range.
 * @param {Object} poleRadiusPx The radius of the dot drawn on poles in pixels.
 * @param {Object} poleDistPx The distance between the poles and the end of meridian lines in pixels.
 */
function Graticule(style, scaleVisibility, poleRadiusPx, poleDistPx) {"use strict";

    Graticule.prototype = new AbstractLayer();
    AbstractLayer.call(this, style, scaleVisibility);

    // if the graticule spacing is larger than this value, no meridians are pruned at poles.
    var MIN_PRUNING_SPACING = 30 / 180 * Math.PI;
    var MAX_ANGLE_COS = Math.cos(177 * Math.PI / 180);
    var MAX_RECURSION = 20;
    var MAX_SEGMENT_LENGTH = 5;

    var EPS = 1.0e-7;

    // FIXME remove graticule
    var graticule = this;

    var maxLengthSquare;

    Graticule.GRATICULE_DIV = 10;
    Graticule.getGraticuleSpacing = function(relativeMapScale) {

        // FIXME: make this configurable
        var d = 5;
        if (relativeMapScale < 1.5) {
            d = 45;
        } else if (relativeMapScale < 3) {
            d = 30;
        } else if (relativeMapScale < 6) {
            d = 15;
        } else if (relativeMapScale < 13) {
            d = 10;
        }
        return d * Math.PI / 180;
    };

    function drawCurvedLineSegment(projection, rotation, ctx, lonStart, lonEnd, latStart, latEnd, poleDist, callCounter, startXY) {

        function projectWithPoleDist(lon, lat, xy, poleDist) {
            // keep a minimum distance to the poles
            // add a distance of EPS to avoid lines that are converging towards the projected poles
            if (lat > Math.PI / 2 - poleDist - EPS) {
                lat = Math.PI / 2 - poleDist - EPS;
            }
            if (lat < -Math.PI / 2 + poleDist + EPS) {
                lat = -Math.PI / 2 + poleDist + EPS;
            }
            if (rotation) {
                rotation.transform(lon, lat, xy);
                projection.forward(xy[0], xy[1], xy);
            } else {
                projection.forward(lon, lat, xy);
            }
        }

        function needsRefinement(x0, y0, x1, y1, x2, y2) {
            var length1Sq, length2Sq, cos_alpha;

            x1 = x1 - x0;
            y1 = y1 - y0;
            x2 = x2 - x0;
            y2 = y2 - y0;
            length1Sq = x1 * x1 + y1 * y1;
            length2Sq = x2 * x2 + y2 * y2;

            // make sure segments are not too long, which causes the line to leave non-convex graticules
            if (length1Sq > maxLengthSquare || length2Sq > maxLengthSquare) {
                return true;
            }
            // test angle betweeen line segments
            cos_alpha = (x1 * x2 + y1 * y2) / (Math.sqrt(length1Sq) * Math.sqrt(length2Sq));
            // the angle has to be close to 180 degrees
            return cos_alpha > MAX_ANGLE_COS;
        }

        var xy = [],
        // start point
        x1 = startXY[0], y1 = startXY[1],
        // middle point
        lonMiddle = (lonStart + lonEnd) / 2, latMiddle = (latStart + latEnd) / 2, xm, ym,
        // end point
        x2, y2;

        // end point
        projectWithPoleDist(lonEnd, latEnd, xy, poleDist);
        x2 = xy[0];
        y2 = xy[1];

        // middle point
        projectWithPoleDist(lonMiddle, latMiddle, xy, poleDist);
        xm = xy[0];
        ym = xy[1];

        if (callCounter < MAX_RECURSION && needsRefinement(xm, ym, x1, y1, x2, y2)) {
            drawCurvedLineSegment(projection, rotation, ctx, lonStart, lonMiddle, latStart, latMiddle, poleDist, callCounter += 1, startXY);
            startXY[0] = xm;
            startXY[1] = ym;
            drawCurvedLineSegment(projection, rotation, ctx, lonMiddle, lonEnd, latMiddle, latEnd, poleDist, callCounter += 1, startXY);
        } else {
            ctx.lineTo(xm, ym);
            ctx.lineTo(x2, y2);
            startXY[0] = x2;
            startXY[1] = y2;
        }
    }


    Graticule.addParallelPathToCanvas = function(projection, rotation, ctx, lat, west, east, lineSegment) {

        function addParallelPathToCanvasPart(west, east) {
            var pt = [], x, y, prevX, prevY, lon, i, nSegments;

            if (rotation) {
                rotation.transform(west, lat, pt);
                projection.forward(pt[0], pt[1], pt);
            } else {
                projection.forward(west, lat, pt);
            }
            ctx.moveTo(pt[0], pt[1]);

            nSegments = Math.floor((east - west) / lineSegment) - 1;
            for ( i = 0; i < nSegments; i += 1) {
                lon = west + i * lineSegment;
                drawCurvedLineSegment(projection, rotation, ctx, lon, lon + lineSegment, lat, lat, 0, 0, pt);
            }

            // add the last segment
            lon += lineSegment;
            drawCurvedLineSegment(projection, rotation, ctx, lon, east - EPS, lat, lat, 0, 0, pt);
        }

        // split the parallel in 2 pieces along the center of the map to avoid horizontal lines
        // connecting the left and right graticule border when the globe is rotated.
        addParallelPathToCanvasPart(west, -EPS);
        addParallelPathToCanvasPart(EPS, east);
    };

    function addMeridianPathToCanvas(ctx, lon, firstParallelID, lastParallelID, latitudeDist, poleDist) {
        var xy = [], nSegments = Graticule.GRATICULE_DIV, segLength = latitudeDist / nSegments, lat, parallelID, seg;

        // FIXME
        lat = Math.max(firstParallelID * latitudeDist, -Math.PI / 2 + poleDist);
        if (graticule.rotation) {
            graticule.rotation.transform(lon, lat, xy);
            graticule.projection.forward(xy[0], xy[1], xy);
        } else {
            graticule.projection.forward(lon, lat, xy);
        }

        ctx.moveTo(xy[0], xy[1]);

        for ( parallelID = firstParallelID; parallelID < lastParallelID; parallelID += 1) {
            for ( seg = 0; seg < nSegments; seg += 1) {
                lat = parallelID * latitudeDist + seg * segLength;
                drawCurvedLineSegment(graticule.projection, graticule.rotation, ctx, lon, lon, lat, lat + segLength, poleDist, 0, xy);
            }
        }
    }


    this.drawPole = function(ctx, lat) {
        var xy = [], r;
        r = poleRadiusPx / this.mapScale;

        // reduce the radius for small scale
        // FIXME this should be relative to the graticule height
        // FIXME this should be definable in MapContent
        r = Math.min(r, this.canvas.height / 1000);

        if (graticule.rotation) {
            graticule.rotation.transform(0, lat, xy);
            this.projection.forward(xy[0], xy[1], xy);
        } else {
            this.projection.forward(0, lat, xy);
        }
        this.drawCircle(ctx, xy, r);
        ctx.fill();

        // If the pole is not centered on the map, the globe is rotated before projection.
        // Draw a second pole mirrored along the central meridian for this case.
        if (Math.abs(xy[0]) > EPS) {
            xy[0] = -xy[0];
            this.drawCircle(ctx, xy, r);
            ctx.fill();
        }
    };

    this.render = function(fastRender, zoomToMap) {

        var shortenMeridiansNearPoles, meridianID, parallelID, bb, d, ctx, spacing, lineSegment, lon0, dLon0, nParallelsOnSphere, firstMeridianID, lastMeridianID, firstParallelID, lastParallelID, lon0ID, poleDist, southID, northID;

        if (!this.isVisible()) {
            return;
        }

        // compute the maximum length of a segment depending on the current map scale.
        d = MAX_SEGMENT_LENGTH / graticule.mapScale;
        maxLengthSquare = d * d;

        ctx = this.canvas.getContext('2d');
        this.applyStyle(ctx);
        this.setupTransformation(ctx);

        if (zoomToMap) {
            bb = this.visibleGeographicBoundingBoxCenteredOnLon0;
        } else {
            bb = {
                west : -Math.PI,
                east : Math.PI,
                north : Math.PI / 2,
                south : -Math.PI / 2
            };
        }
        spacing = Graticule.getGraticuleSpacing(this.relativeMapScale);
        if (!zoomToMap) {
            spacing = Math.max(spacing, 30 * Math.PI / 180);
        }
        lineSegment = spacing / Graticule.GRATICULE_DIV;
        lon0 = this.mapCenter.lon0;
        dLon0 = lon0 % spacing;
        nParallelsOnSphere = Math.round(Math.PI / spacing);

        // longitude of first (west-most) meridian
        firstMeridianID = Math.floor(bb.west / spacing);
        if (firstMeridianID * spacing - dLon0 < -Math.PI) {
            firstMeridianID += 1;
        }

        // longitude of last (east-most) meridian
        lastMeridianID = Math.ceil(bb.east / spacing);
        if (lastMeridianID * spacing - dLon0 > Math.PI) {
            lastMeridianID -= 1;
        }

        // latitude of first (south-most) parallel
        firstParallelID = Math.floor(bb.south / spacing);
        if (this.southPoleVisible) {
            firstParallelID = -Math.round(Math.PI / 2 / spacing);
        }

        // latitude of last (north-most) parallel
        lastParallelID = Math.ceil(bb.north / spacing);
        if (this.northPoleVisible) {
            lastParallelID = Math.round(Math.PI / 2 / spacing);
        }

        // find out whether poles should be drawn as points and meridians shortened near poles
        var POLE_TOL = 0.3 / 180 * Math.PI;
        if (this.relativeMapScale < this.map.getScaleLimits()[0]) {
            // A world map projection is used and the map is only partially visible.
            // Only draw poles as dots if the map is rotated.
            shortenMeridiansNearPoles = this.map.isRotateSmallScale() && Math.abs(this.map.getCentralLatitude()) > POLE_TOL;
        } else {
            // A world map projection is used and the entire globe is visible, or a projection
            // for medium or large scales is used.
            // Draw the poles as dots if the central latitude is not the equator
            shortenMeridiansNearPoles = Math.abs(this.map.getCentralLatitude()) > POLE_TOL;
        }
        poleDist = shortenMeridiansNearPoles ? (poleDistPx / this.mapScale) : 0;

        // id of the central meridian
        lon0ID = lon0 < 0 ? Math.ceil(lon0 / spacing) : Math.floor(lon0 / spacing);
        // draw meridians
        ctx.beginPath();
        for ( meridianID = firstMeridianID; meridianID <= lastMeridianID; meridianID += 1) {
            southID = firstParallelID;
            northID = lastParallelID;

            if (spacing < MIN_PRUNING_SPACING) {
                // prune meridian if it ends at the north pole
                if (lastParallelID >= nParallelsOnSphere / 2 && (meridianID + lon0ID) % 4 !== 0) {
                    northID -= 1;
                }
                // prune meridian if it ends at the parallel next to the north pole
                if ((lastParallelID >= nParallelsOnSphere / 2 - 1) && (meridianID + lon0ID) % 2 !== 0) {
                    // prune every other of those that do not reach the pole
                    northID -= 1;
                }
                // prune meridian if it ends at the south pole
                if (firstParallelID <= -nParallelsOnSphere / 2 && (meridianID + lon0ID) % 4 !== 0) {
                    southID += 1;
                }
                // prune meridian if it ends at the parallel next to the south pole
                if ((firstParallelID <= -nParallelsOnSphere / 2 + 1) && (meridianID + lon0ID) % 2 !== 0) {
                    southID += 1;
                }
            }
            addMeridianPathToCanvas(ctx, meridianID * spacing - dLon0, southID, northID, spacing, poleDist);
        }

        // draw parallels
        if (firstParallelID === -nParallelsOnSphere / 2) {
            // don't draw north pole as a line
            firstParallelID += 1;
        }
        if (lastParallelID === nParallelsOnSphere / 2) {
            // don't draw south pole as a line
            lastParallelID -= 1;
        }
        for ( parallelID = firstParallelID; parallelID <= lastParallelID; parallelID += 1) {
            Graticule.addParallelPathToCanvas(this.projection, this.rotation, ctx, parallelID * spacing, bb.west, bb.east, lineSegment);
        }
        ctx.stroke();

        // draw dots at north and south pole
        if (shortenMeridiansNearPoles) {
            this.drawPole(ctx, Math.PI / 2);
            this.drawPole(ctx, -Math.PI / 2);
        }
    };

}