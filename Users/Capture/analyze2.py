import math

import numpy as np
import matplotlib.pyplot as plt
from scipy.spatial import ConvexHull
from math import cos, sin


def rotate_points(points, angle):
    """Rotate points by a given angle in radians."""
    rotation_matrix = np.array([[cos(angle), -sin(angle)], [sin(angle), cos(angle)]])
    return np.dot(points, rotation_matrix)


def get_bounding_box_area(points):
    """Calculate area of the bounding box for given points."""
    min_x, max_x = min(points[:, 0]), max(points[:, 0])
    min_y, max_y = min(points[:, 1]), max(points[:, 1])
    return (max_x - min_x) * (max_y - min_y)
def find_minimum_bounding_box(xy_points):

    hull = ConvexHull(xy_points)
    hull_points = xy_points[hull.vertices]

    min_area = float('inf')
    best_angle = 0
    trial_count = 0

    for edge in range(len(hull_points)):
        p1, p2 = hull_points[edge], hull_points[(edge + 1) % len(hull_points)]
        angle = np.arctan2(p2[1] - p1[1], p2[0] - p1[0])

        rotated_points = rotate_points(xy_points, angle)
        area = get_bounding_box_area(rotated_points)

        min_x, max_x = min(rotated_points[:, 0]), max(rotated_points[:, 0])
        min_y, max_y = min(rotated_points[:, 1]), max(rotated_points[:, 1])
        bounding_box = np.array([
            [min_x, min_y],
            [min_x, max_y],
            [max_x, max_y],
            [max_x, min_y],
            [min_x, min_y]  # Close the box
        ])
        if area < min_area:
            min_area = area
            best_angle = angle


    best_fit_points = rotate_points(xy_points, best_angle)
    min_x, max_x = min(best_fit_points[:, 0]), max(best_fit_points[:, 0])
    min_y, max_y = min(best_fit_points[:, 1]), max(best_fit_points[:, 1])
    print(f'Best fit bounding box: ({min_x}, {min_y}), ({max_x}, {max_y})')
    bounding_box = np.array([
        [min_x, min_y],
        [min_x, max_y],
        [max_x, max_y],
        [max_x, min_y],
        [min_x, min_y]  # Close the box
    ])

    rotated_bounding_box = rotate_points(bounding_box, -best_angle)

    return rotated_bounding_box, min_area, best_angle
points = np.array([
    [599138.7712915652, 6615298.370719725, 2.07],
    [599142.2831478172, 6615300.285625901, 2.07],
    [599137.6365345651, 6615300.474989724, 2.07],
    [599141.1483908172, 6615302.3898959, 2.07],
    [599136.4121775652, 6615302.618349724, 2.07],
    [599139.9240338173, 6615304.5332559, 2.07],
    [599135.1877075651, 6615304.837129725, 2.07],
    [599138.6995638172, 6615306.752035901, 2.07],
    [599133.9539265651, 6615307.094899725, 2.07],
    [599137.4657828172, 6615309.009805901, 2.07],
    [599132.7039485652, 6615309.207839725, 2.07],
    [599136.2158048173, 6615311.1227459, 2.07],
    [599131.4863595652, 6615311.425749725, 2.07],
    [599134.9982158173, 6615313.340655901, 2.07],
    [599130.3289025652, 6615313.559959725, 2.07],
    [599133.8407588173, 6615315.4748659, 2.07],
    [599129.1201705652, 6615315.691529725, 2.07],
    [599132.6320268173, 6615317.606435901, 2.07],
    [599127.8729645652, 6615318.020169725, 2.07],
    [599131.3848208173, 6615319.9350759005, 2.07],
    [599126.6837785651, 6615320.110039725, 2.07],
    [599130.1956348172, 6615322.024945901, 2.07],
    [599125.4551515651, 6615322.320269724, 2.07],
    [599128.9670078172, 6615324.2351759, 2.07],
    [599143.6448348544, 6615332.285778358, -1.07],
    [599140.1360328372, 6615330.365281441, -1.07],
    [599144.9073528545, 6615329.9080083575, -1.07],
    [599141.3985508373, 6615327.987511441, -1.07],
    [599146.1629508544, 6615327.657748357, -1.07],
    [599142.6541488372, 6615325.737251441, -1.07],
    [599147.2077438545, 6615325.667438357, -1.07],
    [599143.6989418373, 6615323.746941441, -1.07],
    [599148.6713028544, 6615323.228838357, -1.07],
    [599145.1625008372, 6615321.308341441, -1.07],
    [599149.7952668545, 6615321.188448357, -1.07],
    [599146.2864648373, 6615319.267951441, -1.07],
    [599150.9483458544, 6615319.162688357, -1.07],
    [599147.4395438372, 6615317.24219144, -1.07],
    [599152.1344798545, 6615316.965478357, -1.07],
    [599148.6256778373, 6615315.0449814405, -1.07],
    [599153.3101458545, 6615314.767648357, -1.07],
    [599149.8013438373, 6615312.847151441, -1.07],
    [599154.4697408545, 6615312.635878357, -1.07],
    [599150.9609388373, 6615310.715381441, -1.07],
    [599155.7009578544, 6615310.442898357, -1.07],
    [599152.1921558372, 6615308.522401441, -1.07],
    [599156.8933438545, 6615308.2475983575, -1.07],
    [599153.3845418373, 6615306.327101441, -1.07]
])

# Extract only the x, y coordinates
xy_points = points[:, :2]

# Calculate the convex hull of the points
hull = ConvexHull(xy_points)

# Find the minimum bounding box for the given points
rotated_bounding_box, min_area, best_angle = find_minimum_bounding_box(xy_points)

# Plot the points, their convex hull, and the minimum area bounding box
# plt.figure()
# plt.plot(xy_points[:, 0], xy_points[:, 1], 'o', label='Points')
# for simplex in hull.simplices:
#     plt.plot(xy_points[simplex, 0], xy_points[simplex, 1], 'k-')
# plt.plot(rotated_bounding_box[:, 0], rotated_bounding_box[:, 1], 'r--', label=f'Minimum Area Bounding Box{min_area}')
# plt.legend()
# plt.show(), min_area, best_angle
import math as m
def find_rectangles(points):
    """
    For each point, find the distance to the nearest point in both x and y directions.
    Returns a list of distances for each point in the format: [distance_x, distance_y].
    """
    rectangles = []
    for i, point in enumerate(points):
        min_dist =  float('inf')

        for j, other_point in enumerate(points):
            if i == j:
                continue  # Skip the same point comparison

            dist = m.sqrt((point[0] - other_point[0])**2 + (point[1] - other_point[1])**2)/2
            if dist < min_dist:
                min_dist = dist
        rect_corners = np.array([
            [point[0] - min_dist, point[1] - min_dist],
            [point[0] + min_dist, point[1] - min_dist],
            [point[0] + min_dist, point[1] + min_dist],
            [point[0] - min_dist, point[1] + min_dist]
        ])
        rectangles.append(rect_corners)

    return rectangles

testxy = rotate_points(xy_points, best_angle)
rotbox = rotate_points(rotated_bounding_box, best_angle)
rectangles = find_rectangles(testxy)

import matplotlib.patches as patches

fig, ax = plt.subplots()
ax.plot(rotbox[:, 0], rotbox[:, 1], 'r--', label='Bounding Box')
ax.plot(testxy[:, 0], testxy[:, 1], 'o', label='Points')

for patch in rectangles:
    polygon = patches.Polygon(patch, closed=True, fill=None, edgecolor='r', linestyle='--')
    ax.add_patch(polygon)
fig.show()

# plt.figure()
# plt.plot(rotbox[:, 0], rotbox[:, 1], 'r--', label='Bounding Box')
# plt.plot(testxy[:, 0], testxy[:, 1], 'o', label='Points')
# plt.show()
