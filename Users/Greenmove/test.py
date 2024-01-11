from scipy.spatial import ConvexHull
import numpy as np
import matplotlib.pyplot as plt

def rotate_points(points, angle, origin):
    """Rotate a set of points around an origin"""
    rot_mat = np.array([[np.cos(angle), -np.sin(angle)],
                        [np.sin(angle),  np.cos(angle)]])
    return np.dot(points - origin, rot_mat) + origin

def min_bounding_rect(coordinates):
    points = np.array([(coord[0], coord[1]) for coord in coordinates])
    hull_points = points[ConvexHull(points).vertices]
    origin = np.mean(hull_points, axis=0)

    min_bbox = None
    min_area = None

    for i in range(len(hull_points)):
        angle = np.arctan2(hull_points[i][1] - hull_points[i-1][1], hull_points[i][0] - hull_points[i-1][0])
        rotated_pts = rotate_points(hull_points, -angle, origin)
        min_x = np.min(rotated_pts[:, 0])
        max_x = np.max(rotated_pts[:, 0])
        min_y = np.min(rotated_pts[:, 1])
        max_y = np.max(rotated_pts[:, 1])
        area = (max_x - min_x) * (max_y - min_y)

        if min_area is None or area < min_area:
            min_area = area
            corner_points = np.array([[min_x, min_y],
                                      [max_x, min_y],
                                      [max_x, max_y],
                                      [min_x, max_y]])
            min_bbox = rotate_points(corner_points, angle, origin)

    return min_bbox


def plot_minimum_bounding_rectangle(rectangle_coords, coordinates):
    # Plot the original points
    x = [coord[0] for coord in coordinates]
    y = [coord[1] for coord in coordinates]
    plt.scatter(x, y, color='blue', label='Original Points')

    # Plot the minimum bounding rectangle
    x_rect = [coord[0] for coord in rectangle_coords]
    y_rect = [coord[1] for coord in rectangle_coords]
    plt.plot(x_rect + [x_rect[0]], y_rect + [y_rect[0]], color='red', label='Minimum Bounding Rectangle')

    plt.xlabel('X')
    plt.ylabel('Y')
    plt.legend()
    plt.grid(True)
    plt.axis('equal')
    plt.show()

# Example usage
coordinates = [(0, 0, 0, 0, '', '', ''),
               (0.5, 0.5, 0, 0, '', '', ''),
               (1, 1.5, 0, 0, '', '', ''),
               (0, 1, 0, 0, '', '', '')]

# Get the rectangle coordinates
rectangle_coords = min_bounding_rect(coordinates)

# Plot the minimum bounding rectangle
plot_minimum_bounding_rectangle(rectangle_coords, coordinates)