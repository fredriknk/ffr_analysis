import os
import sys
import time
from collections import defaultdict
import numpy as np
import pickle
sys.path.append(os.path.split(os.path.split(
    os.path.realpath(__file__))[0])[0])  # sorry
import regression
import licor_indexes
import get_data
import divide_left_and_right
import bisect_find
import read_regression_exception_list
import pylab as plt

regression_errors = []


class G:  # (G for global) # todo get rid of
    res_file_name = 'slopes.txt'
    directory = ''
    interval = 100
    co2_guides = True
    co2_lag_time = 0
    startdate = False
    stopdate = False
    filter_fun = False


def get_regression_segments(data, regressions):
    """returns a dict of dicts of tuples of lists, res[side][substance] =
    (t, y, t0, y0) where t0, y0 are the lists of time and measurements
    (in seconds and ppm, so far) for the substance, and t0 and y0 are the
    time and measurements picked for regression on given side ('left' or 'right')

    """
    ar = np.array
    res = defaultdict(dict)
    for side, rdict in regressions.items():
        for substance, reg in rdict.items():
            if reg is None:
                continue
            t0, y0 = data[substance][:2]
            t = [ti for (I1, I2) in reg.Iswitch for ti in t0[I1:I2]]
            y = [yi for (I1, I2) in reg.Iswitch for yi in y0[I1:I2]]
            i0 = bisect_find.bisect_find(t, reg.start, nearest=True)
            i1 = bisect_find.bisect_find(t, reg.stop, nearest=True)
            t = t[i0:i1]
            y = y[i0:i1]
            res[side][substance] = (ar(t0), ar(y0), ar(t), ar(y))
    return res


def plot_regressions(data, regressions, normalized=True, markers=None):
    """ plotting the n2o and co2 with regression lines.
    The CO2 is scaled to match the N2O"""

    if markers is None:
        markers = 'r. r- g. g- b. k. k-- c. c-- y.'
        
    regression_segments = get_regression_segments(data, regressions)

    if regression_segments['left']:
        tN2O, yN2O, tN2O_left, yN2O_left = regression_segments['left']['N2O']
        tCO2, yCO2, tCO2_left, yCO2_left = regression_segments['left']['CO2']
        r = regressions['left']['CO2']
        CO2_left_regy = tCO2_left*r.slope + r.intercept
        r = regressions['left']['N2O']
        N2O_left_regy = tN2O_left*r.slope + r.intercept
    if regression_segments['right']:
        tN2O, yN2O, tN2O_right, yN2O_right = regression_segments['right']['N2O']
        tCO2, yCO2, tCO2_right, yCO2_right = regression_segments['right']['CO2']
        r = regressions['right']['CO2']
        CO2_right_regy = tCO2_right*r.slope + r.intercept
        r = regressions['right']['N2O']
        N2O_right_regy = tN2O_right*r.slope + r.intercept

    ax1 = plt.gca()
    ax1.grid()
    ax2 = ax1.twinx()

    s = markers.split()
    ax2.plot(tCO2, yCO2,                 s[9])
    if regression_segments['left']:
        ax1.plot(tN2O_left, yN2O_left,       s[0],
                 tN2O_left, N2O_left_regy,   s[1], markersize=20)
        ax2.plot(tCO2_left, yCO2_left,       s[5],
                 tCO2_left, CO2_left_regy,   s[6])
    if regression_segments['right']:
        ax1.plot(tN2O_right, yN2O_right,     s[2],
                 tN2O_right, N2O_right_regy, s[3], markersize=20)
        ax2.plot(tCO2_right, yCO2_right,     s[7],
                 tCO2_right, CO2_right_regy, s[8])
    ax1.plot(tN2O, yN2O,  s[4])

    # some empty plots in ax2 to get the legend right. Not saying this is good
    indexes = {'left':range(5), 'right': range(5,10)}
    s2 = [(i, x) for i,x in enumerate(s)]
    for side in {'left', 'right'}:
        if not regression_segments[side]:
            for x in s2:
                if x[0] in indexes[side]:
                    s2.remove(x)
    s = [x[1] for x in s2]
    print (s)
    print ([x for c in s for x in [[], [], c]])
    ax2.plot(*[x for c in s for x in [[], [], c]])
    
    leg = ['N2O_left', 'N2O_left', 'N2O_right', 'N2O_right', 'N2O',
           'CO2_left', 'CO2_left', 'CO2_right', 'CO2_right', 'CO2']
    for side in ['left', 'right']:
        if not regression_segments[side]:
            leg = [x for x in leg if not x.endswith(side)]
    ax2.legend(leg)
    
    ax2.set_xlabel('seconds')
    ax1.set_ylabel('ppm N2O')
    ax2.set_ylabel('ppm CO2')

# def plot_regressions(data, regressions, plotfun, normalized=True, do_plot=True):
#     """ plotting the n2o and co2 with regression lines.
#     The CO2 is scaled to match the N2O"""
#     def min_and_max(x): return min(x), max(x)

#     def stretch(y, a, b):
#         return [(x + b) * a for x in y]

#     def make_plotargs(key, color, a, b):
#         plotargs = []
#         d = data[key]

#         def nrm(y):
#             return stretch(y, a, b)
#         plotargs.extend([d[0], nrm(d[1]), color + '.'])
#         for side, rdict in regressions.items():
#             reg = rdict[key]
#             t0, y0 = data[key][:2]
#             t = [ti for (I1, I2) in reg.Iswitch for ti in t0[I1:I2]]
#             y = [yi for (I1, I2) in reg.Iswitch for yi in y0[I1:I2]]
#             i0 = bisect_find.bisect_find(t, reg.start, nearest=True)
#             i1 = bisect_find.bisect_find(t, reg.stop, nearest=True)
#             t = t[i0:i1]
#             y = y[i0:i1]
#             plotargs.extend([t, nrm(y), color + 'o',
#                              t, nrm(reg.intercept + reg.slope * np.array(t)),
#                              color])
#         return plotargs
#     plotargs = []
#     min_n2o, max_n2o = min_and_max(data['N2O'][1])
#     min_co2, max_co2 = min_and_max(data['CO2'][1])
#     a = (max_n2o - min_n2o) / max(1e-10, max_co2 - min_co2)
#     b = (min_n2o * max_co2 - max_n2o * min_co2) / max(1e-10, max_n2o - min_n2o)
#     plotargs.extend(make_plotargs('CO2', 'b', a, b))
#     plotargs.extend(make_plotargs('N2O', 'r', 1, 0))
#     if do_plot:
#         plotfun(*plotargs)
#     else:
#         return plotargs
#         # plotfun('set_ylim', ymin-span*.1, ymax+span*.1)


def remove_zeros(t, y):
    t = np.array(t)
    y = np.array(y)
    t = t[y != 0]
    y = y[y != 0]
    return t, y


def write_result_to_file(res, name, options_string, f):
    for side, sideres in res.items():
        s = os.path.split(name)[1] + '\t' + side
        s += '\t' + options_string
        ok = []
        for key, regres in sideres.items():
            ok.append(regres is not None)
            if regres is None:
                continue
            s += '\t{0}\t{1}'.format(key, regres.slope)
        if all(ok):
            f.write(s + '\n')
        elif any(ok):
            print('\n******************************')
            print('In %s, %s:'%(name, side))
            print('Regressions found for at least one substance, but not all. This in not yet handled by this software. Line not written to file')
            print('******************************\n')

def get_filenames(directory_or_files, G):
    if isinstance(directory_or_files, (list, tuple)):
        return directory_or_files
    else:
        return get_data.select_files(directory_or_files, G)


dbg = []


class Options_manager(object):
    """Manages options for the Regressor objects. `options` are dicts on the
    form {'interval':100, 'crit': mse, 'co2_guides': True}, occasionally 
    {'interval':100, 'crit': mse, 'left':{'N2O': {'start':1, 'stop':100}}}, 
    or similar.

    Special exceptions, called ex_options, specific for each raw data
    filename, are read from an excel file and stored in
    self.ex_options_dict. These ex_options are used as far as
    possible, augmented by the default options (self.options) when the
    information in ex_options are insufficient (for example, when the
    ex_options are only concerning the left side, or only N2O.)

    """

    def __init__(self, options, ex_options_file_name=None):
        self.options = options
        self.ex_options_file_name = ex_options_file_name
        self.update_ex_options_dict()

    def update_ex_options_dict(self, exopts_filename=None):
        if exopts_filename is None:
            exopts_filename = self.ex_options_file_name
        if exopts_filename:
            self.ex_options_dict = read_regression_exception_list.parse_xls_file(
                exopts_filename)
        else:
            self.ex_options_dict = {}

    def get_ex_options(self, filename):
        if filename in self.ex_options_dict:
            return self.ex_options_dict[filename]
        else:
            return {}

    def get_options_string(self, filename=None):
        """Will be used to save a representation for the options used for a given
        filename (or the current one)."""
        return repr((self.get_ex_options(filename), self.options)).replace('\t',' ')
    
    def get_options(self, side, substance, filename_or_ex_options):
        if isinstance(filename_or_ex_options, str):
            filename = os.path.split(filename_or_ex_options)[1]
            ex_options = self.get_ex_options(filename)
        else:
            ex_options = filename_or_ex_options
        return self.extract_options(side, substance, ex_options, self.options)

    def enough(self, opts, substance):
        ok_key_combinations = [['slope'],
                               ['start', 'stop'],
                               ['interval', 'crit', 'CO2'],
                               ['interval', 'crit', 'co2_guides']]
        keys = list(opts) + [substance]
        for k in ok_key_combinations:
            if all([x in keys for x in k]):
                return True
        return False

    def extract_options(self, side, subst, pref, alt={}):
        """tries to get the options we need, recursively, for doing regression
         on substance subst on side side. More complicated than it should
         be, this. pref is a dict containing the preferred options, but if
         there is not information in pref, we look in alt (alternativge)

        This funciton is used when we have given ex_options for the
        regression. The ex_options may have information only for some of
        the regressions to be done (e.g., one side or one substance).  On
        the first call, pref will be the ex_options, and alt will be the
        default options

        examples:

        default = {'co2_guides':True, 'interval':10, 'crit':'heia'}
        ex_options = {'co2_guides':True, 'left': {'N2O': {'start':1, 'stop':4}}}

        extract_options('left', 'N2O', ex_options, default) => {'start': 1, 'stop': 4}

        extract_options('left', 'CO2', ex_options, default)
        => {'co2_guides': True, 'interval': 10, 'crit': 'heia'}

        """
        def add_dicts(a, b):
            return {**a, **b}

        def extract_options_popping_pref(key):
            pref2 = pref.copy()
            pref2 = pref2.pop(key)
            return self.extract_options(side, subst, pref2, pref)
        res = dict()
        if side in pref:
            res = add_dicts(extract_options_popping_pref(side), res)
        if not self.enough(res, subst):
            if subst in pref:
                res = add_dicts(extract_options_popping_pref(subst), res)
        if not self.enough(res, subst):
            res = add_dicts(pref, res)
        if not self.enough(res, subst):
            res = add_dicts(alt, res)  # var alt2
        for s in ['left', 'right', 'CO2', 'N2O']:
            res.pop(s, None)
        return res

    def __repr__(self):
        s = 'Options_manager instance with (if it is called options):\n'
        s += '   options.options = %s\n' % repr(self.options)
        s += '   options.ex_options_file_name = %s\n' % repr(
            self.ex_options_file_name)
        s += '   (options.ex_options_dict contains the ex_options)'
        return s


class Regressor(object):

    """Makes a regressor object with regression parameters given in the
        dict "options". Example:
        options = {'interval': 100, 'crit': 'steepest', 'co2_guides': True}
        regr = find_regressions.Regressor(slopes_filename, options, exception_list_filename)

        The parameter "interval" is the width in seconds of the segment
        over which to perform the regressions. The parameter "crit"
        can be 'steepest' or 'mse'; regressions will be done where the
        curves are steepest or where they have the lowest mse,
        respectively. If co2_guides==True, the interval in time where
        the co2 curve is the steepest or has the best mse is used for
        the time of regression for the N2O.

    """

    def __init__(self, slopes_file_name, options, ex_options_file_name=None):
        self.options = Options_manager(options, ex_options_file_name)
        self.slopes_file_name = slopes_file_name

    def _get_divide_cut_param(self, ex_options):
        def get_maybe(key, default):
            if key in ex_options:
                return ex_options[key]
            elif key in self.options.options:
                return self.options.options['key']
            else:
                return default
        return {'cut_before':get_maybe('cut_before', 3),
                'cut_after':get_maybe('cut_after', 4)}
        
    def find_all_slopes(self, filename_or_data, do_plot=False, given_ex_options=False):
        """Finds the regression lines for N2O and CO2, for left and right
        side
        returns {'left':{'CO2':(Regression, (x,y)),'N2O':...}, {'right': ...}}

        given_ex_options may be given; if not, ex_options will be found from the filename
        """
        if isinstance(filename_or_data, str):
            data = get_data.get_file_data(filename_or_data)
        else:
            data = filename_or_data
            
        if given_ex_options is False:
            ex_options = self.options.get_ex_options(data['filename'])
        else:
            ex_options = given_ex_options

        cut_param = self._get_divide_cut_param(ex_options)
        rawdict = divide_left_and_right.group_all(data, **cut_param)

        keys = ['CO2',  'N2O']
        regressions = {'left': {}, 'right': {}}
        
        for side in list(regressions.keys()):
            tbest = None
            for key in keys:
                regressions[side][key], tbest = self._regress1(rawdict, side, key,
                                                               ex_options, tbest)
            if len(list(regressions[side].keys())) == 0:
                regressions.pop(side)
        if do_plot:
            plot_regressions(data, regressions)
        return regressions

    def _regress1(self, rawdict, side, key, ex_options, tbest):
        # rawdict is like {'CO2': x1, 'N2O': x2, ...}
        # where x1 and x2 is like{'left':(t,y,Istartstop), 'right':(t,y,Istartstop)}
        # and Istartstop is [(Istart, Istop), (Istart, Istop)...]
        # (Istartstop are indexes determining
        # which part of the data has been used for the regression for one side)
        options = self.options.get_options(side, key, ex_options)
        t, y = remove_zeros(*rawdict[key][side][:2])
        if len(t) == 0:
            reg = None
        elif 'slope' in options:  # manually set
            reg = regression.Regression(
                t[0], options['slope'], 0, 0, 0, t[0], t[-1])
        elif 'start' in options and 'stop' in options:
            reg = regression.regress_within(t, y, options['start'], options['stop'])
        elif key != 'CO2' and options['co2_guides'] and tbest is not None:
            reg = regression.regress_within(t, y, *tbest)
        else:
            reg = regression.find_best_regression(
                t, y, options['interval'], options['crit'])
            if key == 'CO2' and reg is not None:
                tbest = reg.start, reg.stop
        if reg is not None:
            reg.Iswitch = rawdict[key][side][2]
        return reg, tbest

    def do_regressions(self, files, write_mode='w'):

        def print_info_maybe(i, n, t0, n_on_line):
            t = time.time()
            if t - t0 > 2:
                print('%d/%d   ' % (i, n), end='')
                t0 = t
                n_on_line += 1
                if n_on_line > 4:
                    n_on_line = 0
                    print('')
            return t0, n_on_line

        if not files:
            print('\nNo regressions to do\n')
            return dict(), []
        print('Doing regressions')
        n = len(files)
        t0 = time.time()
        resdict = {}
        n_on_line = 0
        errors = []
        with open(self.slopes_file_name, write_mode) as f:
            for i, name in enumerate(files):
                t0, n_on_line = print_info_maybe(i, n, t0, n_on_line)
                try:
                    data = get_data.get_file_data(name)
                    res = self.find_all_slopes(data)
                    write_result_to_file(
                        res, name, self.options.get_options_string(), f)
                    resdict[os.path.split(name)[1]] = res
                except Exception as e:
                    import traceback
                    errors.append([name, traceback.format_exc()])
                    # continue
        print_info_maybe(i, n, 0, 100000)
        print('Regression done on %d files with %d errors' %
              (len(files), len(errors)))
        if len(errors):
            regression_errors.append(errors)
            print('See find_regressions.regression_errors[-1]')
        return resdict, errors

    def find_regressions(self, directory_or_files):
        files = get_filenames(directory_or_files, {})
        resdict, errors = self.do_regressions(files)
        with open(os.path.splitext(self.slopes_file_name)[0] + '.pickle', 'wb') as f:
            pickle.dump(resdict, f)

    def update_regressions_file(self, directory_or_files):
        """ this assumes that all files is in the same directory"""
        files = get_filenames(directory_or_files, {})
        directory = os.path.split(files[0])[0]
        lines = [x.split('\t') for x in
                 open(self.slopes_file_name, 'r').readlines()]
        if os.path.isfile(self.slopes_file_name):
            done = [(x[0], x[2]) for x in lines]  # this is name and options
        else:
            done = []
        done = [(os.path.join(directory, x[0]), x[1]) for x in done]
        must_be_done = [(x, self.options.get_options_string(x)) for x in files]
        rest = sorted(set(must_be_done) - set(done))
        q = (len(must_be_done), len(must_be_done) - len(rest))
        print('Regressions: %d files, %d already done with the same options' % q)
        files = [x[0] for x in rest]
        resdict, errors = self.do_regressions(files, 'a')
        pickle_name = os.path.splitext(self.slopes_file_name)[0] + '.pickle'
        try:
            old_dict = pickle.load(open(pickle_name), 'rb')
        except:
            print('File ', pickle_name, 'not found. Starting empty')
            old_dict = {}
        resdict = {**old_dict, **resdict}
        with open(pickle_name, 'wb') as f:
            pickle.dump(resdict, f)

    def __repr__(self):
        s = "Regressor with \nslopes_file_name = %s\noptions = %s"\
            % (self.slopes_file_name, repr(self.options))
        return s


def print_reg(regres):
    for k, dct in regres.items():
        print(k)
        for subst, reg in dct.items():
            print(subst)
            print(reg)



